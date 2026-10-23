import { communitySlugSchema, createCommunityWithOwner, newId, type Database } from "@cohory/db";
import {
  auditLog,
  categories,
  comments,
  communities,
  memberStats,
  memberships,
  posts,
  users,
} from "@cohory/db/schema";
import { LimitReachedError } from "@cohory/fair-use";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureFiles } from "./importers/fixtures";
import { runImportJob } from "./runner";
import { createMigrationService } from "./service";
import {
  createScratchDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";

let database: TestDatabase;
let files: TempStorage;

async function ownedCommunity(db: Database, ownerEmail: string) {
  const [owner] = await db
    .insert(users)
    .values({ email: ownerEmail, name: "Owner" })
    .returning({ id: users.id });
  if (!owner) throw new Error("owner insert failed");
  const created = await createCommunityWithOwner(db, {
    ownerUserId: owner.id,
    slug: communitySlugSchema.parse(`imp-${newId().slice(-12)}`),
    name: "Moved here",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  return {
    actor: { kind: "user" as const, userId: owner.id, platformAdmin: false },
    ownerId: owner.id,
    communityId: created.community.id,
  };
}

beforeAll(async () => {
  database = await createScratchDatabase("cohory_importers");
  files = await tempStorage();
});

afterAll(async () => {
  await database?.close();
  await files?.remove();
});

describe("platform importers through the archive pipeline", () => {
  it("imports a Skool export with members, categories, posts, and comments", async () => {
    const { deps, runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const { actor, ownerId, communityId } = await ownedCommunity(
      database.admin,
      "ada@skool-fixture.test",
    );

    const uploaded = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    expect(uploaded.status).toBe("ready");
    if (uploaded.kind !== "import" || !uploaded.preview?.source) throw new Error("no preview");
    expect(uploaded.preview.source.importer).toEqual({ id: "skool", version: "1.0.0" });
    expect(uploaded.preview.counts).toMatchObject({ memberships: 3, posts: 3, comments: 4 });
    expect(uploaded.preview.people).toEqual({
      total: 3,
      existing: 1,
      new: 2,
      keptApart: 0,
      inviteOnly: false,
    });
    expect(uploaded.preview.warnings).toContain(
      "Price, tier, and lifetime value are not imported. Paid access does not transfer.",
    );

    await service.confirmImport(actor, communityId, uploaded.id, { emailChoice: "never" });
    await runImportJob(runtime, { jobId: uploaded.id, communityId });

    const job = await service.getJob(actor, communityId, uploaded.id);
    expect(job.status).toBe("succeeded");
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.users).toEqual({ created: 2, linked: 1, invited: 0 });
    const reportSkipped = uploaded.preview.source.skippedTotal;
    expect(reportSkipped).toBeGreaterThan(0);
    expect(job.summary.skippedTotal).toBe(reportSkipped);
    expect(job.summary.skipped).toContainEqual(
      expect.objectContaining({
        entity: "members.csv",
        sourceId: "line 5",
        reason: "The email is missing or not valid.",
      }),
    );
    expect(job.summary.warnings).toEqual(uploaded.preview.source.warnings);
    const [formerAuthor] = await database.admin
      .select({ name: users.name, erasedAt: users.erasedAt })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(and(eq(posts.communityId, communityId), eq(posts.title, "Weekly wins")));
    expect(formerAuthor?.name).toMatch(/ \(former member\)$/);
    expect(formerAuthor?.erasedAt).not.toBeNull();

    const [community] = await database.admin
      .select({ name: communities.name })
      .from(communities)
      .where(eq(communities.id, communityId));
    expect(community?.name).toBe("Moved here");

    const members = await database.admin
      .select({
        role: memberships.role,
        userId: memberships.userId,
        welcomeSentAt: memberships.welcomeEmailSentAt,
      })
      .from(memberships)
      .where(eq(memberships.communityId, communityId));
    expect(members.map((row) => row.role).sort()).toEqual(["member", "member", "owner"]);
    expect(members.find((row) => row.userId === ownerId)?.role).toBe("owner");
    expect(
      members.filter((row) => row.role !== "owner").every((row) => row.welcomeSentAt !== null),
    ).toBe(true);

    const imported = await database.admin
      .select({ title: posts.title, bodyHtml: posts.bodyHtml, pinnedAt: posts.pinnedAt })
      .from(posts)
      .where(eq(posts.communityId, communityId));
    expect(imported.map((row) => row.title).sort()).toEqual([
      "A picture only",
      "Weekly wins",
      "Welcome to the community",
    ]);
    for (const row of imported) {
      expect(row.bodyHtml).not.toMatch(/<script|onerror|javascript:|<img/);
    }
    expect(imported.filter((row) => row.pinnedAt !== null)).toHaveLength(1);

    const threaded = await database.admin
      .select({ parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.communityId, communityId));
    expect(threaded).toHaveLength(4);
    expect(threaded.filter((row) => row.parentId !== null)).toHaveLength(2);

    const categoryRows = await database.admin
      .select({ slug: categories.slug, staffOnly: categories.staffOnly })
      .from(categories)
      .where(eq(categories.communityId, communityId));
    expect(categoryRows.map((row) => row.slug)).toContain("wins");

    const stats = await database.admin
      .select({ points: memberStats.pointsTotal })
      .from(memberStats)
      .where(eq(memberStats.communityId, communityId));
    expect(stats.map((row) => row.points).sort((a, b) => a - b)).toEqual([0, 35, 120]);

    const [entry] = await database.admin
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.communityId, communityId), eq(auditLog.action, "migration.import")));
    expect(entry?.metadata).toMatchObject({ importer: "skool", importerVersion: "1.0.0" });
  });

  it("on the Cloud Edition keeps every member apart as a placeholder, existing accounts too", async () => {
    const { deps, runtime } = testRuntime(
      database.probe,
      { archives: files.driver, content: files.driver },
      "cloud",
    );
    const service = createMigrationService(deps);
    const { actor, communityId } = await ownedCommunity(
      database.admin,
      `owner-${newId().slice(-8)}@cloud-import.test`,
    );
    const [existing] = await database.admin
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "grace@skool-fixture.test"));
    const graceId =
      existing?.id ??
      (
        await database.admin
          .insert(users)
          .values({ email: "grace@skool-fixture.test", name: "Grace", emailVerified: true })
          .returning({ id: users.id })
      )[0]?.id;
    if (!graceId) throw new Error("no account");

    const uploaded = await service.uploadPlatformImport(
      actor,
      communityId,
      "skool",
      fixtureFiles("skool"),
    );
    if (uploaded.kind !== "import" || !uploaded.preview) throw new Error("no preview");
    expect(uploaded.preview.people).toEqual({
      total: 3,
      existing: 0,
      new: 3,
      keptApart: 3,
      inviteOnly: true,
    });
    await service.confirmImport(actor, communityId, uploaded.id, { emailChoice: "never" });
    await runImportJob(runtime, { jobId: uploaded.id, communityId });

    const job = await service.getJob(actor, communityId, uploaded.id);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.users).toEqual({ created: 0, linked: 0, invited: 3 });
    const graceRows = await database.admin
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, graceId)));
    expect(graceRows).toEqual([]);
    const authored = await database.admin
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.communityId, communityId), eq(posts.authorId, graceId)));
    expect(authored).toEqual([]);
  });

  it("lets the owner choose who wrote the posts of a name two members share", async () => {
    const { deps, runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const { actor, communityId } = await ownedCommunity(database.admin, "owner@same-name.test");
    const encode = (text: string) => new TextEncoder().encode(text);
    const uploaded = await service.uploadPlatformImport(actor, communityId, "skool", [
      {
        name: "members.csv",
        bytes: encode(
          [
            "FirstName,LastName,Email,JoinedDate",
            "Sam,Lee,sam.one@same-name.test,2025-01-01",
            "Sam,Lee,sam.two@same-name.test,2025-01-02",
          ].join("\n"),
        ),
      },
      {
        name: "posts.json",
        bytes: encode(
          JSON.stringify([{ id: "p1", title: "Hi", content: "Hello", author: "Sam Lee" }]),
        ),
      },
    ]);
    if (uploaded.kind !== "import" || !uploaded.preview?.source) throw new Error("no preview");
    const [ambiguous] = uploaded.preview.source.ambiguousAuthors;
    const chosen = ambiguous?.candidates.find((entry) => entry.email === "sam.two@same-name.test");
    if (!ambiguous || !chosen) throw new Error("expected an ambiguous author");
    expect(uploaded.preview.source.formerMemberAuthors).toBe(0);

    await expect(
      service.confirmImport(actor, communityId, uploaded.id, {
        authors: { [ambiguous.placeholderId]: ambiguous.placeholderId },
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await service.confirmImport(actor, communityId, uploaded.id, {
      authors: { [ambiguous.placeholderId]: chosen.id },
    });
    await runImportJob(runtime, { jobId: uploaded.id, communityId });

    const [author] = await database.admin
      .select({ email: users.email })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.communityId, communityId));
    expect(author?.email).toBe("sam.two@same-name.test");
  });

  it("imports a Circle export and maps spaces to categories", async () => {
    const { deps, runtime } = testRuntime(database.probe, {
      archives: files.driver,
      content: files.driver,
    });
    const service = createMigrationService(deps);
    const { actor, communityId } = await ownedCommunity(database.admin, "owner@circle-host.test");

    const uploaded = await service.uploadPlatformImport(
      actor,
      communityId,
      "circle",
      fixtureFiles("circle"),
    );
    await service.confirmImport(actor, communityId, uploaded.id, {});
    await runImportJob(runtime, { jobId: uploaded.id, communityId });
    const job = await service.getJob(actor, communityId, uploaded.id);
    expect(job.status).toBe("succeeded");

    const rows = await database.admin
      .select({ title: posts.title, categoryId: posts.categoryId, bodyHtml: posts.bodyHtml })
      .from(posts)
      .where(eq(posts.communityId, communityId));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.categoryId !== null)).toBe(true);
    expect(rows.find((row) => row.title === "Read this first")?.bodyHtml).toContain(
      'data-embed-provider="youtube"',
    );
    const roles = await database.admin
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.communityId, communityId));
    expect(roles.map((row) => row.role).sort()).toEqual(["admin", "moderator", "owner"]);
  });

  it("refuses to start when the import would pass the member limit", async () => {
    const setup = testRuntime(database.probe, { archives: files.driver, content: files.driver });
    const deps = {
      ...setup.deps,
      fairUse: { ...setup.deps.fairUse, free: { ...setup.deps.fairUse.free, members: 2 } },
    };
    const service = createMigrationService(deps);
    const { actor, communityId } = await ownedCommunity(database.admin, "owner@limit.test");

    const uploaded = await service.uploadPlatformImport(
      actor,
      communityId,
      "circle",
      fixtureFiles("circle"),
    );
    if (uploaded.kind !== "import") throw new Error("wrong kind");
    expect(uploaded.preview?.warnings.some((warning) => warning.includes("allows 2"))).toBe(true);
    expect(uploaded.preview?.source?.overMemberLimit).toBe(true);
    await expect(service.confirmImport(actor, communityId, uploaded.id, {})).rejects.toBeInstanceOf(
      LimitReachedError,
    );
  });

  it("only lets the owner import and rejects unknown platforms", async () => {
    const { deps } = testRuntime(database.probe, { archives: files.driver, content: files.driver });
    const service = createMigrationService(deps);
    const { actor, communityId } = await ownedCommunity(database.admin, "owner@guard.test");
    const [stranger] = await database.admin
      .insert(users)
      .values({ email: "stranger@guard.test", name: "Stranger" })
      .returning({ id: users.id });
    if (!stranger) throw new Error("insert failed");
    await database.admin
      .insert(memberships)
      .values({ communityId, userId: stranger.id, role: "admin", status: "active" });

    await expect(
      service.uploadPlatformImport(
        { kind: "user", userId: stranger.id, platformAdmin: false },
        communityId,
        "skool",
        fixtureFiles("skool"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.admin
      .delete(memberships)
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, stranger.id)));
    await expect(
      service.uploadPlatformImport(actor, communityId, "mighty", fixtureFiles("skool")),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.uploadPlatformImport(actor, communityId, "skool", [
        { name: "notes.txt", bytes: new TextEncoder().encode("nothing") },
        { name: "posts.json", bytes: new TextEncoder().encode('[\n  {"id": 1,}\n]') },
      ]),
    ).rejects.toMatchObject({
      code: "validation_failed",
      message:
        "Nothing in these files can be imported from Skool. notes.txt is not a Skool export file. posts.json is not valid JSON at line 2.",
    });
  });
});
