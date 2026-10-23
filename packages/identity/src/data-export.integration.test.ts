import { UnauthenticatedError, type Actor } from "@cohory/authz";
import {
  communitySlugSchema,
  createCommunityWithOwner,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  accountAuditLog,
  creatorFeedback,
  notificationSettings,
  posts,
  users,
} from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDataExportService,
  dataExportDownloadedAction,
  dataExportRequestedAction,
  type DataExportLink,
} from "./data-export";
import { DataExportNotFoundError, DataExportRateLimitedError } from "./errors";

const probeRole = "cohory_identity_export_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

const hourMs = 60 * 60 * 1000;
let clock = new Date("2026-10-22T10:00:00Z").getTime();
const now = () => new Date(clock);
const sent: DataExportLink[] = [];
const committedWhenSent: boolean[] = [];

async function requestRowVisible(exportId: string): Promise<boolean> {
  const rows = await adminDb
    .select({ id: accountAuditLog.id })
    .from(accountAuditLog)
    .where(eq(accountAuditLog.id, exportId));
  return rows.length === 1;
}

const exports = createDataExportService({
  db: appDb,
  now,
  pageSize: 2,
  sendLink: async (link) => {
    sent.push(link);
    committedWhenSent.push(await requestRowVisible(link.exportId));
  },
  listPaidMemberships: async () => [],
});

type UserActor = Actor & { kind: "user" };

async function person(name: string): Promise<{ actor: UserActor; email: string }> {
  const email = `export-${newId()}@example.test`;
  const [row] = await adminDb.insert(users).values({ name, email }).returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return { actor: { kind: "user", userId: row.id, platformAdmin: false }, email };
}

async function community(ownerId: string, name: string) {
  const result = await createCommunityWithOwner(adminDb, {
    slug: communitySlugSchema.parse(`ex-${newId().slice(-12)}`),
    name,
    ownerUserId: ownerId,
  });
  if (result.kind !== "created") throw new Error("slug taken");
  return result.community;
}

async function join(communityId: string, userId: string): Promise<void> {
  await adminDb.execute(
    sql`insert into memberships (id, community_id, user_id, role, status, joined_at) values (${newId()}, ${communityId}, ${userId}, 'member', 'active', now())`,
  );
}

async function post(communityId: string, authorId: string, text: string): Promise<void> {
  await adminDb.execute(sql`
    insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt)
      values (${newId()}, ${communityId}, ${authorId}, '{}'::jsonb, ${`<p>${text}</p>`}, ${text}, ${text})`);
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function comment(communityId: string, authorId: string, text: string): Promise<void> {
  const [row] = await adminDb
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.communityId, communityId))
    .limit(1);
  if (!row) throw new Error("comment needs a post");
  await adminDb.execute(sql`
    insert into comments (id, community_id, post_id, author_id, body, body_html, body_text)
      values (${newId()}, ${communityId}, ${row.id}, ${authorId}, '{}'::jsonb, ${`<p>${text}</p>`}, ${text})`);
}

function files(zip: Uint8Array): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(unzipSync(zip)).map(([name, bytes]) => [
      name,
      name.endsWith(".json") ? JSON.parse(strFromU8(bytes)) : strFromU8(bytes),
    ]),
  );
}

beforeAll(async () => {
  await adminDb.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select on communities, users, memberships, posts, comments, events, event_occurrences, event_rsvps, lessons, lesson_progress, member_stats, notification_preferences, notification_settings, creator_feedback to ${probeRole};
    grant select, insert on account_audit_log to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("requesting a data export", () => {
  it("records the request and emails a link that works for 7 days", async () => {
    const ada = await person("Ada");

    const request = await exports.requestExport(ada.actor);

    expect(request.expiresAt.getTime() - clock).toBe(7 * 24 * hourMs);
    expect(sent.at(-1)).toEqual({
      userId: ada.actor.userId,
      email: ada.email,
      name: "Ada",
      exportId: request.exportId,
      expiresAt: request.expiresAt,
    });
    const rows = await adminDb
      .select({ id: accountAuditLog.id })
      .from(accountAuditLog)
      .where(
        and(
          eq(accountAuditLog.userId, ada.actor.userId),
          eq(accountAuditLog.action, dataExportRequestedAction),
        ),
      );
    expect(rows).toEqual([{ id: request.exportId }]);
    expect(committedWhenSent.at(-1)).toBe(true);
    expect(request.emailed).toBe(true);
  });

  it("lets only one of two requests at the same moment through", async () => {
    const kai = await person("Kai");

    const results = await Promise.allSettled([
      exports.requestExport(kai.actor),
      exports.requestExport(kai.actor),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(
      DataExportRateLimitedError,
    );
    const rows = await adminDb
      .select({ id: accountAuditLog.id })
      .from(accountAuditLog)
      .where(
        and(
          eq(accountAuditLog.userId, kai.actor.userId),
          eq(accountAuditLog.action, dataExportRequestedAction),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("keeps a request whose email failed usable from the account page", async () => {
    const lea = await person("Lea");
    const failing = createDataExportService({
      db: appDb,
      now,
      sendLink: async () => {
        throw new Error("smtp down");
      },
      listPaidMemberships: async () => [],
    });

    const request = await failing.requestExport(lea.actor);

    expect(request.emailed).toBe(false);
    expect(await failing.latestExport(lea.actor)).toMatchObject({ exportId: request.exportId });
    const download = await failing.openExport(lea.actor, request.exportId);
    expect(files(await bytesOf(download.stream))["README.txt"]).toContain("copy of your account");
  });

  it("allows one request a day", async () => {
    const bea = await person("Bea");
    await exports.requestExport(bea.actor);

    await expect(exports.requestExport(bea.actor)).rejects.toBeInstanceOf(
      DataExportRateLimitedError,
    );

    clock += 24 * hourMs + 1;
    await expect(exports.requestExport(bea.actor)).resolves.toMatchObject({
      exportId: expect.any(String),
    });
  });

  it("refuses a signed out caller", async () => {
    const guest: Actor = { kind: "guest" };
    await expect(exports.requestExport(guest)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(exports.openExport(guest, newId())).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("downloading a data export", () => {
  it("contains the person's own data from every community and nobody else's", async () => {
    const owner = await person("Owner");
    const cara = await person("Cara");
    const gardeners = await community(owner.actor.userId, "Gardeners");
    const bakers = await community(owner.actor.userId, "Bakers");
    await join(gardeners.id, cara.actor.userId);
    await join(bakers.id, cara.actor.userId);
    await post(gardeners.id, cara.actor.userId, "Cara in gardeners");
    await post(bakers.id, cara.actor.userId, "Cara in bakers");
    await post(gardeners.id, owner.actor.userId, "Owner secret plan");

    const { exportId } = await exports.requestExport(cara.actor);
    const download = await exports.openExport(cara.actor, exportId);
    const content = files(await bytesOf(download.stream));

    expect(download.filename).toMatch(/^data-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(content["profile.json"]).toMatchObject({ name: "Cara", email: cara.email });
    const serialized = JSON.stringify(content);
    expect(serialized).toContain("Cara in gardeners");
    expect(serialized).toContain("Cara in bakers");
    expect(serialized).not.toContain("Owner secret plan");
    expect(serialized).not.toContain(owner.email);
    expect(content[`communities/${gardeners.slug}.json`]).toMatchObject({
      community: { name: "Gardeners", slug: gardeners.slug },
      membership: { role: "member" },
    });
  });

  it("includes the person's own feedback answers and opt out, and nobody else's", async () => {
    const owner = await person("Owner");
    const fay = await person("Fay");
    const potters = await community(fay.actor.userId, "Potters");
    const optedOut = new Date("2026-10-20T09:00:00Z");
    await adminDb
      .insert(notificationSettings)
      .values({ userId: fay.actor.userId, creatorFeedbackOptedOutAt: optedOut });
    await adminDb.insert(creatorFeedback).values([
      {
        userId: fay.actor.userId,
        communityId: potters.id,
        kind: "moment",
        topic: "first_post",
        status: "answered",
        score: 4,
        comment: "A sample post to copy.",
        respondedAt: optedOut,
      },
      {
        userId: owner.actor.userId,
        kind: "exit",
        topic: "delete_account",
        status: "answered",
        comment: "Owner private reason",
        respondedAt: optedOut,
      },
    ]);

    const { exportId } = await exports.requestExport(fay.actor);
    const content = files(await bytesOf((await exports.openExport(fay.actor, exportId)).stream));

    expect(content["feedback.json"]).toEqual([
      expect.objectContaining({
        kind: "moment",
        topic: "first_post",
        score: 4,
        comment: "A sample post to copy.",
        community: potters.slug,
      }),
    ]);
    expect(content["profile.json"]).toMatchObject({
      notifications: { settings: { creatorFeedbackOptedOutAt: optedOut.toISOString() } },
    });
    expect(JSON.stringify(content)).not.toContain("Owner private reason");
    expect(content[`communities/${potters.slug}.json`]).not.toHaveProperty("feedback");
  });

  it("does not let another person download someone's export", async () => {
    const dan = await person("Dan");
    const eve = await person("Eve");
    const { exportId } = await exports.requestExport(dan.actor);

    await expect(exports.openExport(eve.actor, exportId)).rejects.toBeInstanceOf(
      DataExportNotFoundError,
    );
  });

  it("stops working 7 days after the request", async () => {
    const fay = await person("Fay");
    const { exportId } = await exports.requestExport(fay.actor);

    clock += 7 * 24 * hourMs + 1;

    await expect(exports.openExport(fay.actor, exportId)).rejects.toBeInstanceOf(
      DataExportNotFoundError,
    );
  });

  it("answers an id that is not an export the same way", async () => {
    const gus = await person("Gus");
    await expect(exports.openExport(gus.actor, "not-a-uuid")).rejects.toBeInstanceOf(
      DataExportNotFoundError,
    );
  });
});

describe("streaming a data export", () => {
  it("reads posts and comments page by page and still includes all of them", async () => {
    const owner = await person("Owner");
    const hal = await person("Hal");
    const club = await community(owner.actor.userId, "Club");
    await join(club.id, hal.actor.userId);
    for (let index = 1; index <= 5; index += 1) {
      await post(club.id, hal.actor.userId, `Hal post ${index}`);
    }
    for (let index = 1; index <= 3; index += 1) {
      await comment(club.id, hal.actor.userId, `Hal comment ${index}`);
    }

    const { exportId } = await exports.requestExport(hal.actor);
    const download = await exports.openExport(hal.actor, exportId);
    const clubFile = files(await bytesOf(download.stream))[`communities/${club.slug}.json`];

    expect(clubFile).toMatchObject({
      posts: [1, 2, 3, 4, 5].map((index) => ({ text: `Hal post ${index}` })),
      comments: [1, 2, 3].map((index) => ({ text: `Hal comment ${index}` })),
    });
  });

  it("records each download in the account activity", async () => {
    const ivy = await person("Ivy");
    const { exportId } = await exports.requestExport(ivy.actor);

    await bytesOf((await exports.openExport(ivy.actor, exportId)).stream);

    const rows = await adminDb
      .select({ metadata: accountAuditLog.metadata })
      .from(accountAuditLog)
      .where(
        and(
          eq(accountAuditLog.userId, ivy.actor.userId),
          eq(accountAuditLog.action, dataExportDownloadedAction),
        ),
      );
    expect(rows).toEqual([{ metadata: { exportId } }]);
  });

  it("says in the README what the export leaves out", async () => {
    const jo = await person("Jo");
    const { exportId } = await exports.requestExport(jo.actor);

    const readme = files(await bytesOf((await exports.openExport(jo.actor, exportId)).stream))[
      "README.txt"
    ];

    expect(readme).toContain(
      "Not included: reactions, notifications, uploaded files, and API tokens.",
    );
  });
});

describe("account activity in a data export", () => {
  it("reads the account activity page by page into its own file", async () => {
    const max = await person("Max");
    const first = await exports.requestExport(max.actor);
    clock += 24 * hourMs + 1;
    const second = await exports.requestExport(max.actor);

    const content = files(
      await bytesOf((await exports.openExport(max.actor, second.exportId)).stream),
    );

    expect(content["profile.json"]).not.toHaveProperty("activity");
    expect(content["activity.json"]).toEqual([
      { action: dataExportRequestedAction, createdAt: expect.any(String) },
      { action: dataExportRequestedAction, createdAt: expect.any(String) },
      { action: dataExportDownloadedAction, createdAt: expect.any(String) },
    ]);
    expect(first.exportId).not.toBe(second.exportId);
  });
});
