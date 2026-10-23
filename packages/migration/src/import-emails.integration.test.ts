import {
  communitySlugSchema,
  createCommunityWithOwner,
  newId,
  withCommunity,
  type Database,
} from "@cohory/db";
import { hashEmailAddress } from "@cohory/email";
import { accounts, memberships, posts, users, verifications } from "@cohory/db/schema";
import { and, eq, like, sql } from "drizzle-orm";
import { createManageService, createPostgresManageRepository } from "@cohory/communities";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { createGamificationService } from "@cohory/gamification";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFiles } from "./importers/fixtures";
import type { ImportFile } from "./importers/types";
import { migrationImportFinishedJob } from "./jobs";
import { runExportJob, runImportFinishedJob, runImportJob } from "./runner";
import { createRuntime } from "./runtime";
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

beforeAll(async () => {
  database = await openDatabase(currentDatabaseName());
  files = await tempStorage();
});

afterAll(async () => {
  await database.close();
  await files.remove();
});

function taggedSkool(tag: string): ImportFile[] {
  return fixtureFiles("skool").map((file) =>
    file.name === "members.csv"
      ? {
          ...file,
          bytes: new TextEncoder().encode(
            new TextDecoder()
              .decode(file.bytes)
              .replaceAll("@skool-fixture.test", `+${tag}@example.com`),
          ),
        }
      : file,
  );
}

const address = (name: string, tag: string) => `${name}+${tag}@example.com`;

async function addUser(db: Database, email: string, name: string): Promise<string> {
  const [row] = await db.insert(users).values({ email, name }).returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

interface Setup {
  readonly edition?: "community" | "cloud";
  readonly suppressed?: readonly string[];
  readonly memberLimit?: number;
  readonly perDay?: number;
  readonly now?: () => Date;
}

async function imported(choice: "now" | "later" | "never", setup: Setup = {}, note?: string) {
  const tag = newId().slice(-10);
  const ownerEmail = address("olga", tag);
  const ownerId = await addUser(database.admin, ownerEmail, "Olga Owner");
  const created = await createCommunityWithOwner(database.admin, {
    ownerUserId: ownerId,
    slug: communitySlugSchema.parse(`mail-${newId().slice(-12)}`),
    name: "Moved here",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  const communityId = created.community.id;
  const test = testRuntime(
    database.probe,
    { archives: files.driver, content: files.driver },
    setup.edition ?? "community",
  );
  const suppressed = new Set(
    (setup.suppressed ?? []).map((name) => hashEmailAddress(address(name, tag))),
  );
  const limit = { members: setup.memberLimit ?? null, storageBytes: null, uploadBytes: null };
  const deps = {
    ...test.deps,
    fairUse: { ...test.deps.fairUse, free: limit, paid: limit },
    config: {
      ...test.deps.config,
      ...(setup.perDay === undefined ? {} : { importEmailsPerDay: setup.perDay }),
    },
    ...(setup.now ? { now: setup.now } : {}),
    suppression: {
      isSuppressed: async ({ addressHash }: { addressHash: string }) => suppressed.has(addressHash),
    },
  };
  const service = createMigrationService(deps);
  const runtime = { ...createRuntime(deps), suppression: deps.suppression };
  const actor = { kind: "user" as const, userId: ownerId, platformAdmin: false };
  const uploaded = await service.uploadPlatformImport(
    actor,
    communityId,
    "skool",
    taggedSkool(tag),
  );
  await service.confirmImport(actor, communityId, uploaded.id, {
    emailChoice: choice,
    ...(note ? { note } : {}),
  });
  const payload = { jobId: uploaded.id, communityId };
  await runImportJob(runtime, payload);
  return {
    ...test,
    runtime,
    service,
    actor,
    tag,
    ownerId,
    ownerEmail,
    communityId,
    slug: created.community.slug,
    payload,
  };
}

const memberMail = (sent: { template?: string | undefined }) =>
  sent.template === "community-moved" || sent.template === "member-invited";

describe("import emails", () => {
  it("emails new accounts a single use password link that ends on the community", async () => {
    const { mailer, tag, slug, service, actor, communityId, payload } = await imported(
      "now",
      {},
      "See you at the call on Thursday",
    );

    const moved = mailer.sent.filter((mail) => mail.template === "community-moved");
    expect(moved.map((mail) => mail.to).sort()).toEqual(
      ["ada", "grace", "linus"].map((name) => address(name, tag)),
    );
    const ada = moved.find((mail) => mail.to === address("ada", tag));
    expect(ada?.text).toContain("Olga Owner moved Moved here from Skool to Cohory.");
    expect(ada?.text).toContain("Your posts and comments are already there.");
    expect(ada?.text).toContain('A note from Olga Owner: "See you at the call on Thursday"');
    expect(ada?.text).not.toContain("forgot-password");
    const link =
      /https:\/\/new\.example\.test\/reset-password\?token=([A-Za-z0-9_-]{32,})&next=([^\s]+)/.exec(
        ada?.text ?? "",
      );
    expect(decodeURIComponent(link?.[2] ?? "")).toBe(`/c/${slug}`);
    const [adaUser] = await database.admin
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, address("ada", tag)));
    const [token] = await database.admin
      .select({ value: verifications.value, expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.identifier, `reset-password:${link?.[1]}`));
    expect(token?.value).toBe(adaUser?.id);
    const day = 24 * 60 * 60 * 1000;
    expect(token?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * day);
    expect(token?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * day);

    const job = await service.getJob(actor, communityId, payload.jobId);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.emailsSent).toBe(3);
    expect(job.emailChoice).toBe("now");
    expect(job.emailsSentAt).not.toBeNull();
  });

  it("on the Cloud Edition adds nobody with their own account and emails invitations", async () => {
    const { mailer, tag, communityId, service, actor, payload } = await imported("now", {
      edition: "cloud",
    });

    const preview = await service.getJob(actor, communityId, payload.jobId);
    if (preview.kind !== "import" || !preview.preview || !preview.summary) {
      throw new Error("no preview");
    }
    expect(preview.preview.people).toEqual({
      total: 3,
      existing: 0,
      new: 3,
      keptApart: 3,
      inviteOnly: true,
    });
    expect(preview.summary.users).toEqual({ created: 0, linked: 0, invited: 3 });
    const real = await database.admin
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%+${tag}@example.com`));
    expect(real).toHaveLength(1);
    const placeholders = await database.admin
      .select({ email: users.email, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.communityId, communityId), like(users.email, "imported-%")));
    expect(placeholders.map((row) => row.name).sort()).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Linus Example",
    ]);
    const authored = await database.admin
      .select({ author: users.email })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.communityId, communityId));
    expect(authored.every((row) => !row.author.endsWith("@example.com"))).toBe(true);

    const invites = mailer.sent.filter((mail) => mail.template === "member-invited");
    expect(invites.map((mail) => mail.to).sort()).toEqual(
      ["ada", "grace", "linus"].map((name) => address(name, tag)),
    );
    expect(invites[0]?.text).toContain("Olga Owner moved Moved here from Skool to Cohory.");
    expect(invites[0]?.text).toMatch(/\/join\/[A-Za-z0-9_-]{43}/);
  });

  it("sends nothing until the owner asks, then sends once without a second owner email", async () => {
    const { mailer, queue, runtime, service, actor, communityId, payload } =
      await imported("later");
    expect(mailer.sent.filter(memberMail)).toEqual([]);
    expect(await runImportFinishedJob(runtime, payload)).toBe("succeeded");
    const ownerMails = () =>
      mailer.sent.filter((mail) => mail.template === "migration-import-finished");
    expect(ownerMails()).toHaveLength(1);
    expect(ownerMails()[0]?.text).toContain("send the emails from Import history");

    const requested = await service.sendImportEmails(actor, communityId, payload.jobId);
    expect(requested.emailsSentAt).not.toBeNull();
    expect(queue.sent.at(-1)).toEqual({ name: migrationImportFinishedJob, payload });
    await runImportFinishedJob(runtime, payload);
    await runImportFinishedJob(runtime, payload);

    expect(mailer.sent.filter(memberMail)).toHaveLength(3);
    expect(ownerMails()).toHaveLength(1);
    const job = await service.getJob(actor, communityId, payload.jobId);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.emailsSent).toBe(3);
    await expect(service.sendImportEmails(actor, communityId, payload.jobId)).rejects.toMatchObject(
      { code: "job_not_ready" },
    );
  });

  it("refuses to send later when the owner chose not to email", async () => {
    const { mailer, service, actor, communityId, payload } = await imported("never");

    expect(mailer.sent.filter(memberMail)).toEqual([]);
    await expect(service.sendImportEmails(actor, communityId, payload.jobId)).rejects.toMatchObject(
      { code: "job_not_ready" },
    );
  });

  it("counts addresses that opted out or bounced as not sent", async () => {
    const { mailer, tag, service, actor, communityId, payload } = await imported("now", {
      suppressed: ["grace"],
    });

    const job = await service.getJob(actor, communityId, payload.jobId);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.emailsSent).toBe(2);
    expect(job.summary.emailsNotSent).toBe(1);
    expect(mailer.sent.filter(memberMail).map((mail) => mail.to)).not.toContain(
      address("grace", tag),
    );
  });

  it("lets only the owner resend one person's email, and not after they set a password", async () => {
    const { mailer, tag, service, actor, communityId } = await imported("now");
    const [grace] = await database.admin
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, address("grace", tag)));
    if (!grace) throw new Error("no grace");

    expect(await service.resendableMembers(actor, communityId)).toContain(grace.id);
    const tokenIn = (text: string | undefined) =>
      /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text ?? "")?.[1];
    const tokens = async () =>
      (
        await database.admin
          .select({ identifier: verifications.identifier })
          .from(verifications)
          .where(eq(verifications.value, grace.id))
      ).map((row) => row.identifier);
    const first = tokenIn(mailer.sent.find((mail) => mail.to === address("grace", tag))?.text);
    expect(await tokens()).toEqual([`reset-password:${first}`]);
    await service.resendImportEmail(actor, communityId, grace.id);
    const graceMail = mailer.sent.filter((mail) => mail.to === address("grace", tag));
    expect(graceMail).toHaveLength(2);
    const second = tokenIn(graceMail[1]?.text);
    expect(second).not.toBe(first);
    expect(await tokens()).toEqual([`reset-password:${second}`]);

    await database.admin.insert(accounts).values({
      userId: grace.id,
      accountId: grace.id,
      providerId: "credential",
      password: "hashed",
    });
    expect(await service.resendableMembers(actor, communityId)).not.toContain(grace.id);
    await expect(service.resendImportEmail(actor, communityId, grace.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const stranger = { kind: "user" as const, userId: grace.id, platformAdmin: false };
    await expect(service.resendImportEmail(stranger, communityId, grace.id)).rejects.toThrow();
  });

  it("shows the owner the email with their note and sends a test only to them", async () => {
    const { mailer, ownerEmail, service, actor, communityId, payload, tag } =
      await imported("later");
    const before = mailer.sent.length;

    const preview = await service.importEmailPreview(actor, communityId, payload.jobId, {
      note: "Welcome over",
    });
    expect(preview.subject).toBe("[Moved here] The community has moved");
    expect(preview.text).toContain('A note from Olga Owner: "Welcome over"');
    expect(preview.text).not.toContain("reset-password");

    await service.sendTestImportEmail(actor, communityId, payload.jobId, { note: "Welcome over" });
    const sent = mailer.sent.slice(before);
    expect(sent.map((mail) => mail.to)).toEqual([ownerEmail]);
    expect(sent[0]?.subject).toBe("Test: [Moved here] The community has moved");
    expect(sent[0]?.text).not.toContain(tag);
  });
});

describe("import email bounds", () => {
  it("emails no more people than the plan allows on Cloud", async () => {
    const { mailer, deps, service, actor, communityId, payload } = await imported("later", {
      edition: "cloud",
      memberLimit: 4,
    });
    const smaller = { members: 2, storageBytes: null, uploadBytes: null };
    const downgraded = { ...deps, fairUse: { ...deps.fairUse, free: smaller, paid: smaller } };
    await createMigrationService(downgraded).sendImportEmails(actor, communityId, payload.jobId);
    await runImportFinishedJob(createRuntime(downgraded), payload);

    expect(mailer.sent.filter(memberMail)).toHaveLength(2);
    const job = await service.getJob(actor, communityId, payload.jobId);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.emailsSent).toBe(2);
    expect(job.summary.emailsOverLimit).toBe(1);
  });

  it("sends at most the daily number of emails per community and the rest the next day", async () => {
    let clock = new Date("2026-10-23T15:00:00.000Z");
    const { mailer, queue, runtime, payload } = await imported("now", {
      perDay: 2,
      now: () => clock,
    });

    expect(mailer.sent.filter(memberMail)).toHaveLength(2);
    await runImportFinishedJob(runtime, payload);
    expect(mailer.sent.filter(memberMail)).toHaveLength(2);
    const nextDay = new Date("2026-10-24T00:00:00.000Z");
    expect(queue.sent.at(-1)).toEqual({
      name: migrationImportFinishedJob,
      payload,
      startAfter: nextDay,
    });
    expect(Object.keys(queue.sent.at(-1)?.payload ?? {}).sort()).toEqual(["communityId", "jobId"]);

    clock = new Date("2026-10-24T00:05:00.000Z");
    await runImportFinishedJob(runtime, payload);
    expect(mailer.sent.filter(memberMail)).toHaveLength(3);
  });
});

describe("who may handle import emails", () => {
  it("refuses admins, moderators, members, and strangers for every email action", async () => {
    const { mailer, tag, service, communityId, payload } = await imported("later");
    const [ada] = await database.admin
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, address("ada", tag)));
    if (!ada) throw new Error("no ada");
    const before = mailer.sent.length;
    const actors: [string, string | null][] = [
      ["admin", "admin"],
      ["moderator", "moderator"],
      ["member", "member"],
      ["stranger", null],
    ];
    for (const [label, role] of actors) {
      const userId = await addUser(database.admin, address(label, tag), label);
      if (role === "admin" || role === "moderator" || role === "member") {
        await database.admin
          .insert(memberships)
          .values({ communityId, userId, role, status: "active", joinedAt: new Date() });
      }
      const actor = { kind: "user" as const, userId, platformAdmin: false };
      const code = role === null ? "not_found" : "forbidden";
      const attempts = [
        () => service.sendImportEmails(actor, communityId, payload.jobId),
        () => service.importEmailPreview(actor, communityId, payload.jobId, {}),
        () => service.sendTestImportEmail(actor, communityId, payload.jobId, {}),
        () => service.resendableMembers(actor, communityId),
        () => service.resendImportEmail(actor, communityId, ada.id),
      ];
      for (const attempt of attempts) {
        await expect(attempt(), `${label}`).rejects.toMatchObject({ code });
      }
    }
    expect(mailer.sent.length).toBe(before);
  });
});

describe("Cloud placeholders", () => {
  async function activeUserIds(communityId: string): Promise<string[]> {
    const rows = await database.admin
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.communityId, communityId), eq(memberships.status, "active")));
    return rows.map((row) => row.userId);
  }

  it("are never members, so an import up to the member limit still lets invitees accept", async () => {
    const { mailer, tag, communityId, ownerId, deps } = await imported("now", {
      edition: "cloud",
      memberLimit: 4,
    });

    expect(await activeUserIds(communityId)).toEqual([ownerId]);
    const manage = createManageService({
      repo: createPostgresManageRepository(database.admin),
      storage: files.driver,
      fairUse: deps.fairUse,
    });
    for (const name of ["ada", "grace", "linus"]) {
      const invite = mailer.sent.find(
        (mail) => mail.template === "member-invited" && mail.to === address(name, tag),
      );
      const token = /\/join\/([A-Za-z0-9_-]{43})/.exec(invite?.text ?? "")?.[1] ?? "";
      const userId = await addUser(database.admin, address(name, tag), name);
      const redeemed = await manage.redeemInvite(
        { kind: "user", userId, platformAdmin: false },
        token,
      );
      expect(redeemed.membership?.status).toBe("active");
    }
    expect(await activeUserIds(communityId)).toHaveLength(4);
  });

  it("are left out of the leaderboard and grant no content access", async () => {
    const { communityId, ownerId } = await imported("never", { edition: "cloud" });
    const placeholders = await database.admin
      .select({ userId: memberships.userId, status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.communityId, communityId), like(users.email, "imported-%")));

    expect(placeholders).toHaveLength(3);
    expect(placeholders.every((row) => row.status !== "active")).toBe(true);
    const owner = { kind: "user" as const, userId: ownerId, platformAdmin: false };
    const board = await createGamificationService({ db: database.admin }).getLeaderboard(
      owner,
      communityId,
    );
    if (board.status !== "enabled") throw new Error("levels are off");
    const ranked = board.entries.map((entry) => entry.userId);
    for (const placeholder of placeholders) {
      expect(ranked).not.toContain(placeholder.userId);
      const access = await getCommunityAccess(
        withCommunity(database.admin, communityId),
        placeholder.userId,
        new Date(),
      );
      expect(access).toEqual({ role: null, entitled: false });
    }
  });
});

describe("owner emails for exports and failed imports", () => {
  it("emails the owner once when an export is ready", async () => {
    const { runtime, mailer, queue, service, actor, communityId } = await imported("never");
    const started = await service.startExport(actor, communityId);
    const payload = { jobId: started.id, communityId };
    await runExportJob(runtime, payload);

    expect(queue.sent.at(-1)).toEqual({ name: migrationImportFinishedJob, payload });
    expect(await runImportFinishedJob(runtime, payload)).toBe("succeeded");
    expect(await runImportFinishedJob(runtime, payload)).toBe("skipped");
    const ready = mailer.sent.filter((mail) => mail.template === "migration-export-ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]?.text).toContain(`/manage/migration/exports/${started.id}/download`);
  });

  it("emails the owner when an import fails for the last time, not on a retried failure", async () => {
    const { runtime, mailer, queue, ownerId, communityId } = await imported("never");
    const send = async (attempts: number) => {
      const job = await runtime.jobs.create(communityId, {
        kind: "import",
        status: "queued",
        requestedBy: ownerId,
      });
      await database.admin.execute(
        sql`update migration_jobs set attempts = ${attempts} where id = ${job.id}`,
      );
      const payload = { jobId: job.id, communityId };
      await expect(runImportJob(runtime, payload)).rejects.toMatchObject({ code: "not_found" });
      return payload;
    };

    const early = await send(0);
    expect(queue.sent.some((sent) => sent.payload.jobId === early.jobId)).toBe(false);
    const last = await send(2);
    expect(queue.sent.at(-1)).toEqual({ name: migrationImportFinishedJob, payload: last });
    expect(await runImportFinishedJob(runtime, last)).toBe("succeeded");
    expect(await runImportFinishedJob(runtime, last)).toBe("skipped");
    const failed = mailer.sent.filter((mail) => mail.template === "migration-import-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.subject).toBe("[Moved here] Your import stopped");
  });
});
