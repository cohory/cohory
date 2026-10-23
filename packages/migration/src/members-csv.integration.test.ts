import { communitySlugSchema, createCommunityWithOwner, newId, type Database } from "@cohory/db";
import { auditLog, inviteLinks, memberships, migrationJobs, users } from "@cohory/db/schema";
import { hashEmailAddress } from "@cohory/email";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMembersImportJob } from "./runner";
import { createMigrationService } from "./service";
import {
  currentDatabaseName,
  openDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";

let database: TestDatabase;
let files: TempStorage;
const suffix = newId().slice(-8);
const email = (name: string) => `${name}-${suffix}@csv.test`;

async function addUser(db: Database, address: string, name: string): Promise<string> {
  const [row] = await db.insert(users).values({ email: address, name }).returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

async function community(ownerEmail: string) {
  const ownerId = await addUser(database.admin, ownerEmail, "Owner");
  const created = await createCommunityWithOwner(database.admin, {
    ownerUserId: ownerId,
    slug: communitySlugSchema.parse(`csv-${newId().slice(-12)}`),
    name: "CSV Club",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  return { ownerId, communityId: created.community.id, slug: created.community.slug };
}

function csv(...rows: string[]): { bytes: Uint8Array; name: string } {
  return { bytes: new TextEncoder().encode(rows.join("\n")), name: "members.csv" };
}

beforeAll(async () => {
  database = await openDatabase(currentDatabaseName());
  files = await tempStorage();
});

afterAll(async () => {
  await database.close();
  await files.remove();
});

describe("members CSV import", () => {
  it("previews every row with its status before anything changes", async () => {
    const { ownerId, communityId } = await community(email("owner-preview"));
    const memberId = await addUser(database.admin, email("already"), "Already");
    await database.admin
      .insert(memberships)
      .values({ communityId, userId: memberId, status: "active" });
    await addUser(database.admin, email("existing"), "Existing");
    const { deps } = testRuntime(database.probe, { archives: files.driver, content: files.driver });
    const service = createMigrationService(deps);

    const job = await service.previewMembersCsv(
      { kind: "user", userId: ownerId, platformAdmin: false },
      communityId,
      csv(
        "email,name,role",
        `${email("new")},New Person,moderator`,
        `${email("existing")},,`,
        `${email("already")},Already,member`,
        "broken,Nobody,member",
      ),
    );

    expect(job.status).toBe("ready");
    if (job.kind !== "members_csv" || !job.preview) throw new Error("no preview");
    expect(job.preview.rows.map((row) => [row.line, row.status])).toEqual([
      [2, "new_account"],
      [3, "existing_account"],
      [4, "already_member"],
      [5, "error"],
    ]);
    expect(job.preview.totals).toEqual({
      rows: 4,
      ready: 2,
      newAccounts: 1,
      alreadyMembers: 1,
      invited: 0,
      leftOut: 0,
      errors: 1,
    });
    expect(
      await database.admin
        .select()
        .from(users)
        .where(eq(users.email, email("new"))),
    ).toEqual([]);
  });

  it("on the Cloud Edition shows one status for every address that is not a member or banned", async () => {
    const { ownerId, communityId } = await community(email("owner-cloud-preview"));
    const memberId = await addUser(database.admin, email("cloud-member"), "Member");
    const bannedId = await addUser(database.admin, email("cloud-banned"), "Banned");
    await database.admin.insert(memberships).values([
      { communityId, userId: memberId, status: "active" },
      { communityId, userId: bannedId, status: "banned" },
    ]);
    await addUser(database.admin, email("cloud-elsewhere"), "Elsewhere");
    const { deps } = testRuntime(
      database.probe,
      { archives: files.driver, content: files.driver },
      "cloud",
    );
    const service = createMigrationService(deps);

    const job = await service.previewMembersCsv(
      { kind: "user", userId: ownerId, platformAdmin: false },
      communityId,
      csv(
        "email,name,role",
        `${email("cloud-elsewhere")},,`,
        `${email("cloud-nobody")},,`,
        `${email("cloud-member")},,`,
        `${email("cloud-banned")},,`,
      ),
    );

    if (job.kind !== "members_csv" || !job.preview) throw new Error("no preview");
    expect(job.preview.rows.map((row) => [row.line, row.status, row.message])).toEqual([
      [2, "ready", null],
      [3, "ready", null],
      [4, "already_member", null],
      [5, "error", "This person is banned from the community."],
    ]);
    expect(job.preview.totals).toEqual({
      rows: 4,
      ready: 2,
      newAccounts: null,
      alreadyMembers: 1,
      invited: 0,
      leftOut: 0,
      errors: 1,
    });
    expect(job.preview.addAllowed).toBe(false);
  });

  it("on the Community Edition invites an existing account whose email is not confirmed instead of adding it", async () => {
    const { ownerId, communityId } = await community(email("owner-unverified"));
    const unconfirmedId = await addUser(database.admin, email("unconfirmed"), "Unconfirmed");
    const confirmedId = await addUser(database.admin, email("confirmed"), "Confirmed");
    await database.admin
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, confirmedId));
    const { deps, runtime, mailer } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name,role", `${email("unconfirmed")},,admin`, `${email("confirmed")},,admin`),
    );

    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add" });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    const rows = await database.admin
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.communityId, communityId));
    expect(rows.find((row) => row.userId === unconfirmedId)).toBeUndefined();
    expect(rows.find((row) => row.userId === confirmedId)).toEqual({
      userId: confirmedId,
      role: "admin",
    });
    const links = await database.admin
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.communityId, communityId));
    expect(links).toHaveLength(1);
    expect(mailer.sent.map((mail) => mail.to)).toEqual([email("unconfirmed")]);
    expect(mailer.sent[0]?.text).toContain(`/join/${links[0]?.token ?? ""}`);
    expect(mailer.sent[0]).toMatchObject({
      communityId,
      headers: {
        "List-Unsubscribe": expect.stringMatching(
          /^<https:\/\/new\.example\.test\/api\/email-opt-out\?token=/,
        ),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    expect(mailer.sent[0]?.text).toMatch(
      /invited you because your address is on their member list for /,
    );
    expect(mailer.sent[0]?.text).toContain("Don't email me about");
    const final = await service.getJob(actor, communityId, job.id);
    expect(final.kind === "members_csv" && final.summary).toMatchObject({
      added: 1,
      invited: 1,
      emailsSent: 1,
    });
  });

  it("adds members directly with their roles on a self hosted instance and writes the audit log", async () => {
    const { ownerId, communityId } = await community(email("owner-add"));
    const { deps, runtime, mailer, queue } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name,role", `${email("ada")},Ada,admin`, `${email("bob")},Bob,`),
    );

    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add", notify: true });
    expect(queue.sent[0]?.name).toBe("migration.members-import");
    await runMembersImportJob(runtime, { jobId: job.id, communityId });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    const rows = await database.admin
      .select({ email: users.email, role: memberships.role, status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.communityId, communityId));
    expect(
      rows.filter((row) => row.role !== "owner").sort((a, b) => a.email.localeCompare(b.email)),
    ).toEqual([
      { email: email("ada"), role: "admin", status: "active" },
      { email: email("bob"), role: "member", status: "active" },
    ]);
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([email("ada"), email("bob")]);
    const final = await service.getJob(actor, communityId, job.id);
    expect(final.kind === "members_csv" && final.summary).toMatchObject({
      added: 2,
      emailsSent: 2,
    });
    const [entry] = await database.admin
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.communityId, communityId), eq(auditLog.action, "migration.members_csv")),
      );
    expect(entry?.metadata).toMatchObject({ mode: "add", added: 2 });
  });

  it("drops the emails from the stored preview once the import succeeds and keeps the counts and report", async () => {
    const { ownerId, communityId } = await community(email("owner-private"));
    const { deps, runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name", `${email("cleo")},Cleo`, "not-an-email,Broken"),
    );
    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add", notify: false });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    const [stored] = await database.admin
      .select({ preview: migrationJobs.preview })
      .from(migrationJobs)
      .where(eq(migrationJobs.id, job.id));
    const text = JSON.stringify(stored?.preview);
    expect(text).not.toContain(email("cleo"));
    expect(text).not.toContain("not-an-email");
    expect(text).not.toContain("Cleo");
    const final = await service.getJob(actor, communityId, job.id);
    expect(final.kind === "members_csv" && final.preview?.totals).toMatchObject({
      rows: 2,
      errors: 1,
    });
    expect(final.kind === "members_csv" && final.summary).toMatchObject({ added: 1 });
    const report = await service.importReport(actor, communityId, job.id);
    expect(report.csv).toContain("members,added,1,");
  });

  it("never sends a welcome email to members added while import emails are off", async () => {
    const { ownerId, communityId } = await community(email("owner-quiet"));
    const { deps, runtime, mailer } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const quiet = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name", `${email("quiet")},Quiet`),
    );
    await service.confirmMembersCsv(actor, communityId, quiet.id, { mode: "add", notify: false });
    await runMembersImportJob(runtime, { jobId: quiet.id, communityId });
    const told = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name", `${email("told")},Told`),
    );
    await service.confirmMembersCsv(actor, communityId, told.id, { mode: "add", notify: true });
    await runMembersImportJob(runtime, { jobId: told.id, communityId });

    const rows = await database.admin
      .select({ email: users.email, welcomeSentAt: memberships.welcomeEmailSentAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.communityId, communityId));
    expect(rows.find((row) => row.email === email("quiet"))?.welcomeSentAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.email === email("told"))?.welcomeSentAt).toBeNull();
    expect(mailer.sent.map((mail) => mail.to)).toEqual([email("told")]);
  });

  it("keeps the welcome time of a former member who is imported again with emails off", async () => {
    const { ownerId, communityId } = await community(email("owner-again"));
    const formerId = await addUser(database.admin, email("former"), "Former");
    await database.admin.update(users).set({ emailVerified: true }).where(eq(users.id, formerId));
    const welcomed = new Date("2026-09-01T10:00:00Z");
    await database.admin.insert(memberships).values({
      communityId,
      userId: formerId,
      status: "removed",
      welcomeEmailSentAt: welcomed,
    });
    const { deps, runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name", `${email("former")},Former`),
    );
    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add", notify: false });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    const [row] = await database.admin
      .select({ status: memberships.status, welcomeSentAt: memberships.welcomeEmailSentAt })
      .from(memberships)
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, formerId)));
    expect(row).toEqual({ status: "active", welcomeSentAt: welcomed });
  });

  it("sends single use invite links instead of adding people in invite mode", async () => {
    const { ownerId, communityId } = await community(email("owner-invite"));
    const { deps, runtime, mailer } = testRuntime(
      database.probe,
      { archives: files.driver, content: files.driver },
      "cloud",
    );
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(actor, communityId, csv("email", email("invitee")));

    await expect(
      service.confirmMembersCsv(actor, communityId, job.id, { mode: "add" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "invite" });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    const links = await database.admin
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.communityId, communityId));
    expect(links).toHaveLength(1);
    expect(links[0]?.maxUses).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain(`/join/${links[0]?.token ?? ""}`);
    const members = await database.admin
      .select()
      .from(memberships)
      .where(eq(memberships.communityId, communityId));
    expect(members).toHaveLength(1);
  });

  it("marks people with an open invitation as invited and only sends again when asked", async () => {
    const { ownerId, communityId } = await community(email("owner-twice"));
    const { deps, runtime, mailer } = testRuntime(
      database.probe,
      { archives: files.driver, content: files.driver },
      "cloud",
    );
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const file = csv("email", email("twice-a"), email("twice-b"));
    const first = await service.previewMembersCsv(actor, communityId, file);
    await service.confirmMembersCsv(actor, communityId, first.id, { mode: "invite" });
    await runMembersImportJob(runtime, { jobId: first.id, communityId });
    expect(mailer.sent).toHaveLength(2);

    const second = await service.previewMembersCsv(actor, communityId, file);
    if (second.kind !== "members_csv" || !second.preview) throw new Error("no preview");
    expect(second.preview.rows.map((row) => row.status)).toEqual(["invited", "invited"]);
    expect(second.preview.rows[0]?.message).toMatch(/^Invited on /);
    expect(second.preview.totals).toMatchObject({ ready: 0, invited: 2 });
    await service.confirmMembersCsv(actor, communityId, second.id, { mode: "invite" });
    await runMembersImportJob(runtime, { jobId: second.id, communityId });
    expect(mailer.sent).toHaveLength(2);

    const third = await service.previewMembersCsv(actor, communityId, file);
    await service.confirmMembersCsv(actor, communityId, third.id, {
      mode: "invite",
      resend: true,
    });
    await runMembersImportJob(runtime, { jobId: third.id, communityId });
    expect(mailer.sent).toHaveLength(4);
  });

  it("re-imports a People export cleanly: the owner row is you and inactive rows are left out", async () => {
    const ownerEmail = email("owner-roundtrip");
    const { ownerId, communityId } = await community(ownerEmail);
    const { deps } = testRuntime(database.probe, { archives: files.driver, content: files.driver });
    const service = createMigrationService(deps);
    const job = await service.previewMembersCsv(
      { kind: "user", userId: ownerId, platformAdmin: false },
      communityId,
      csv(
        "email,name,username,role,status",
        `${ownerEmail},Owner,,owner,active`,
        `${email("rt-active")},Active,,member,active`,
        `${email("rt-banned")},Banned,,member,banned`,
      ),
    );
    if (job.kind !== "members_csv" || !job.preview) throw new Error("no preview");
    expect(job.preview.rows.map((row) => [row.status, row.message])).toEqual([
      ["already_member", "This is you."],
      ["new_account", null],
      ["left_out", "The status in the file is banned, so this row is left out."],
    ]);
    expect(job.preview.totals).toMatchObject({ ready: 1, errors: 0, leftOut: 1 });
  });

  it("stops at the fair use member limit and reports the rows it skipped", async () => {
    const { ownerId, communityId } = await community(email("owner-limit"));
    const setup = testRuntime(database.probe, { archives: files.driver, content: files.driver });
    const deps = {
      ...setup.deps,
      fairUse: { ...setup.deps.fairUse, free: { ...setup.deps.fairUse.free, members: 3 } },
    };
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email", email("l1"), email("l2"), email("l3")),
    );

    await expect(
      service.confirmMembersCsv(actor, communityId, job.id, { mode: "add" }),
    ).rejects.toMatchObject({ code: "limit_reached" });
  });

  it("invites with the owner's note, reports opted out addresses as not sent, and lists skipped rows", async () => {
    const { ownerId, communityId } = await community(email("owner-note"));
    const { deps, runtime, mailer } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const optedOut = hashEmailAddress(email("opted-out"));
    const service = createMigrationService({
      ...deps,
      suppression: { isSuppressed: async ({ addressHash }) => addressHash === optedOut },
    });
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(
      actor,
      communityId,
      csv("email,name", `${email("noted")},Noted`, `${email("opted-out")},Out`, "not-an-email,Bad"),
    );

    await service.confirmMembersCsv(actor, communityId, job.id, {
      mode: "invite",
      note: "We meet on Thursdays",
    });
    await runMembersImportJob(
      {
        ...runtime,
        suppression: { isSuppressed: async ({ addressHash }) => addressHash === optedOut },
      },
      { jobId: job.id, communityId },
    );

    expect(mailer.sent.map((mail) => mail.to)).toEqual([email("noted")]);
    expect(mailer.sent[0]?.text).toContain("Owner invited you to join CSV Club on Cohory.");
    expect(mailer.sent[0]?.text).toContain('A note from Owner: "We meet on Thursdays"');
    const final = await service.getJob(actor, communityId, job.id);
    if (final.kind !== "members_csv" || !final.summary) throw new Error("no summary");
    expect(final.summary).toMatchObject({ invited: 2, emailsSent: 1, notSent: 1, skipped: 1 });
    expect(final.summary.skippedRows).toEqual([
      { line: 3, reason: "Not sent: the address opted out or bounced." },
      { line: 4, reason: expect.any(String) },
    ]);
    expect(JSON.stringify(final.summary)).not.toContain(email("opted-out"));
  });

  it("sends added members without a password a direct password link", async () => {
    const { ownerId, communityId, slug } = await community(email("owner-link"));
    const { deps, runtime, mailer } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const job = await service.previewMembersCsv(actor, communityId, csv("email", email("linked")));

    await service.confirmMembersCsv(actor, communityId, job.id, { mode: "add", notify: true });
    await runMembersImportJob(runtime, { jobId: job.id, communityId });

    expect(mailer.sent[0]?.text).not.toContain("forgot-password");
    expect(mailer.sent[0]?.text).toContain(`/reset-password?token=`);
    expect(mailer.sent[0]?.text).toContain(`next=${encodeURIComponent(`/c/${slug}`)}`);
  });

  it("lets only the owner import members", async () => {
    const { communityId } = await community(email("owner-only"));
    const adminId = await addUser(database.admin, email("admin"), "Admin");
    await database.admin
      .insert(memberships)
      .values({ communityId, userId: adminId, role: "admin", status: "active" });
    const { deps } = testRuntime(database.probe, { archives: files.driver, content: files.driver });

    await expect(
      createMigrationService(deps).previewMembersCsv(
        { kind: "user", userId: adminId, platformAdmin: false },
        communityId,
        csv("email", email("x")),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
