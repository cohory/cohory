import { seedDevEvents } from "@cohory/calendar/seed";
import {
  agentLessonLayerSchema,
  agentSnapshotSchema,
  buildSnapshot,
  sha256Hex,
  snapshotChecksum,
} from "@cohory/courses/agent-format";
import { seedDevCourses } from "@cohory/courses/seed";
import {
  communitySlugSchema,
  createCommunityWithOwner,
  getCommunityBySlug,
  newId,
  type Database,
  type TenantTable,
} from "@cohory/db";
import {
  auditLog,
  comments,
  communities,
  communityGalleryItems,
  compedMemberships,
  reviewReplies,
  reviews,
  courseAgentSettings,
  courseAgentVersions,
  courseModules,
  courses,
  eventOccurrences,
  eventRsvps,
  events,
  inviteLinks,
  lessonAgentLayers,
  lessonProgress,
  lessons,
  memberStats,
  membershipPlans,
  membershipRequests,
  memberships,
  paymentConnections,
  paymentCustomers,
  pointsLedger,
  postImages,
  posts,
  reactions,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { devAdmin, devCreators, devMember, devSeed, seedDevData } from "@cohory/db/seed";
import { seedDevPoints } from "@cohory/gamification/seed";
import { seedDevPosts } from "@cohory/posts/seed";
import { parseStorageKey } from "@cohory/storage";
import { and, asc, count, eq, inArray, isNotNull, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readArchive } from "./format/archive";
import { IdMap } from "./import/id-map";
import { restoreArchive } from "./import/restore";
import { runExportJob, runImportJob } from "./runner";
import { readStoredFile } from "./runtime";
import { createMigrationService } from "./service";
import {
  createScratchDatabase,
  tempStorage,
  testRuntime,
  type TempStorage,
  type TestDatabase,
} from "./test/harness";

const owner = { kind: "user" as const, platformAdmin: false };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pdf = new TextEncoder().encode("%PDF-1.4 lesson notes");

let source: TestDatabase;
let target: TestDatabase;
const stores: TempStorage[] = [];
let sourceStorage: TempStorage;
let archives: TempStorage;
let sourceCommunityId: string;
let archiveBytes: Uint8Array;
let exportJobId: string;
const ids: Record<string, string> = {};

async function storage(): Promise<TempStorage> {
  const created = await tempStorage();
  stores.push(created);
  return created;
}

async function userId(db: Database, email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

async function addUser(db: Database, email: string, name: string, extra = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email, name, ...extra })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

function doc(...content: unknown[]) {
  return { type: "doc" as const, content };
}

async function enrich(db: Database, files: TempStorage): Promise<void> {
  const community = await getCommunityBySlug(db, devSeed.communitySlug);
  if (!community) throw new Error("no dev community");
  const cid = community.id;
  sourceCommunityId = cid;
  ids.owner = await userId(db, devSeed.email);
  ids.member = await userId(db, devMember.email);
  ids.admin = await userId(db, devAdmin.email);

  const logoKey = `communities/${cid}/branding/logo-${newId()}.png`;
  await files.driver.put({ key: parseStorageKey(logoKey), body: png, contentType: "image/png" });
  await db
    .update(communities)
    .set({
      appearance: { accent: "#2563EB", logoKey },
      description: "Makers who ship",
      detailedDescription: doc({
        type: "paragraph",
        content: [{ type: "text", text: "Weekly build nights" }],
      }),
    })
    .where(eq(communities.id, cid));
  const galleryKey = `communities/${cid}/gallery/${newId()}.png`;
  await files.driver.put({ key: parseStorageKey(galleryKey), body: png, contentType: "image/png" });
  await db.insert(communityGalleryItems).values([
    {
      communityId: cid,
      kind: "video_embed",
      embedUrl: "https://www.loom.com/embed/0123456789abcdef",
      position: 0,
    },
    {
      communityId: cid,
      kind: "image",
      storageKey: galleryKey,
      altText: "Build night",
      position: 1,
    },
  ]);

  const imageKey = `communities/${cid}/posts/${newId()}.png`;
  await files.driver.put({ key: parseStorageKey(imageKey), body: png, contentType: "image/png" });
  const postId = newId();
  ids.post = postId;
  await db.insert(posts).values({
    id: postId,
    communityId: cid,
    authorId: ids.owner,
    title: "Show and tell",
    body: doc(
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Great work " },
          { type: "mention", attrs: { id: ids.member, label: "jamie" } },
        ],
      },
      { type: "image", attrs: { key: imageKey, alt: "A photo" } },
    ),
    bodyHtml: "<p>stale html from the source</p>",
    bodyText: "Great work @jamie",
    excerpt: "Great work @jamie",
  });
  await db
    .insert(postImages)
    .values({ communityId: cid, postId, storageKey: imageKey, position: 0 });
  await db.insert(posts).values({
    communityId: cid,
    authorId: ids.owner,
    title: "Coming next week",
    body: doc({ type: "paragraph", content: [{ type: "text", text: "Scheduled" }] }),
    bodyHtml: "<p>Scheduled</p>",
    bodyText: "Scheduled",
    excerpt: "Scheduled",
    scheduledAt: new Date("2030-01-15T09:00:00.000Z"),
  });
  const topId = newId();
  await db.insert(comments).values({
    id: topId,
    communityId: cid,
    postId,
    authorId: ids.member,
    body: doc({ type: "paragraph", content: [{ type: "text", text: "Thanks" }] }),
    bodyHtml: "<p>Thanks</p>",
    bodyText: "Thanks",
  });
  await db.insert(comments).values({
    communityId: cid,
    postId,
    authorId: ids.admin,
    parentId: topId,
    body: doc({ type: "paragraph", content: [{ type: "text", text: "Agreed" }] }),
    bodyHtml: "<p>Agreed</p>",
    bodyText: "Agreed",
  });
  await db.insert(reactions).values({
    communityId: cid,
    userId: ids.admin,
    subjectType: "post",
    subjectId: postId,
    subjectAuthorId: ids.owner,
  });

  const [course] = await db.select().from(courses).where(eq(courses.communityId, cid));
  const [lesson] = await db
    .select()
    .from(lessons)
    .where(eq(lessons.communityId, cid))
    .orderBy(asc(lessons.position), asc(lessons.title))
    .limit(1);
  if (!course || !lesson) throw new Error("courses seed missing");
  await db.update(courses).set({ requiredLevel: 3 }).where(eq(courses.id, course.id));
  await db
    .update(communities)
    .set({ pointsForLessons: true, pointsForEvents: true })
    .where(eq(communities.id, cid));
  const attachmentKey = `communities/${cid}/courses/${course.id}/attachments/${newId()}.pdf`;
  await files.driver.put({
    key: parseStorageKey(attachmentKey),
    body: pdf,
    contentType: "application/pdf",
  });
  await db
    .update(lessons)
    .set({
      attachments: [
        {
          key: attachmentKey,
          name: "notes.pdf",
          size: pdf.byteLength,
          contentType: "application/pdf",
        },
      ],
    })
    .where(eq(lessons.id, lesson.id));
  const agentBytes = new TextEncoder().encode("# Glaze checklist\n");
  const agentKey = `communities/${cid}/courses/${course.id}/agent/${newId()}.md`;
  await files.driver.put({
    key: parseStorageKey(agentKey),
    body: agentBytes,
    contentType: "text/markdown; charset=utf-8",
  });
  const layer = agentLessonLayerSchema.parse({
    objective: "Glaze a test tile",
    instructions: "Follow the checklist.",
    references: [
      {
        title: "Checklist",
        file: {
          name: "checklist.md",
          key: agentKey,
          mediaType: "text/markdown; charset=utf-8",
          size: agentBytes.byteLength,
          sha256: sha256Hex(agentBytes),
        },
      },
    ],
    templates: [],
    tasks: [
      {
        id: "glaze",
        title: "Glaze",
        prompt: "Describe your glaze.",
        inputSchema: { type: "object" },
        outputSchema: { type: "object", required: ["answer"] },
      },
    ],
    evaluations: [{ taskId: "glaze", kind: "schema", spec: { schema: { type: "object" } } }],
  });
  await db.insert(lessonAgentLayers).values({
    lessonId: lesson.id,
    communityId: cid,
    courseId: course.id,
    layer: { ...layer },
  });
  const built = buildSnapshot({
    course,
    lessons: [{ id: lesson.id, slug: lesson.slug, title: lesson.title, layer }],
    version: "1.0.0",
    changelog: "First.",
    publishedAt: new Date("2026-10-11T10:00:00Z"),
    license: { id: "personal-agent-use", text: "" },
    sourceUrl: `https://old.example.test/c/cohory/classroom/${course.slug}`,
  });
  await db.insert(courseAgentSettings).values({
    courseId: course.id,
    communityId: cid,
    allowAgentAccess: true,
    licenseId: "custom",
    licenseText: "Agents of buyers only.",
  });
  await db.insert(courseAgentVersions).values({
    communityId: cid,
    courseId: course.id,
    version: "1.0.0",
    major: 1,
    minor: 0,
    patch: 0,
    changelog: "First.",
    snapshot: { ...built.snapshot },
    checksum: built.checksum,
  });
  await db.insert(lessonProgress).values({
    communityId: cid,
    lessonId: lesson.id,
    courseId: course.id,
    userId: ids.member,
    completedAt: new Date("2026-10-10T10:00:00Z"),
    lastViewedAt: new Date("2026-10-10T10:00:00Z"),
  });

  const [occurrence] = await db
    .select()
    .from(eventOccurrences)
    .where(eq(eventOccurrences.communityId, cid))
    .orderBy(asc(eventOccurrences.startsAt))
    .limit(1);
  if (!occurrence) throw new Error("calendar seed missing");
  await db
    .insert(eventRsvps)
    .values({ communityId: cid, occurrenceId: occurrence.id, userId: ids.member, status: "going" });
  await db.insert(pointsLedger).values([
    {
      communityId: cid,
      userId: ids.member,
      delta: 1,
      reason: "lesson_completed",
      sourceType: "lesson",
      sourceId: lesson.id,
      occurredAt: new Date("2026-10-10T10:00:00Z"),
    },
    {
      communityId: cid,
      userId: ids.member,
      delta: 1,
      reason: "event_attended",
      sourceType: "event_occurrence",
      sourceId: occurrence.id,
      occurredAt: occurrence.endsAt,
    },
  ]);

  await db.insert(compedMemberships).values({
    communityId: cid,
    userId: ids.admin,
    grantedBy: ids.owner,
    note: "Speaker",
  });

  const [review] = await db
    .insert(reviews)
    .values({
      communityId: cid,
      authorId: ids.member,
      rating: 4,
      body: "Kind people and clear weekly lessons.",
      editedAt: new Date("2026-10-11T10:00:00Z"),
    })
    .returning();
  if (!review) throw new Error("review insert failed");
  await db.insert(reviewReplies).values({
    communityId: cid,
    reviewId: review.id,
    authorId: ids.owner,
    body: "Thank you, Jamie.",
  });

  ids.payer = await addUser(db, "payer@cohory.local", "Pat Payer", { emailVerified: true });
  await db
    .insert(memberships)
    .values({ communityId: cid, userId: ids.payer, status: "active", joinedAt: new Date() });
  const [connection] = await db
    .insert(paymentConnections)
    .values({
      communityId: cid,
      provider: "stripe_connect",
      status: "active",
      externalAccountId: `acct_${newId().slice(-12)}`,
    })
    .returning();
  if (!connection) throw new Error("connection insert failed");
  const [plan] = await db
    .insert(membershipPlans)
    .values({
      communityId: cid,
      connectionId: connection.id,
      name: "Members",
      currency: "usd",
      monthlyPriceMinor: 1500,
      providerProductId: "prod_test",
      providerMonthlyPriceId: "price_test",
    })
    .returning();
  const [customer] = await db
    .insert(paymentCustomers)
    .values({
      communityId: cid,
      userId: ids.payer,
      connectionId: connection.id,
      externalCustomerId: "cus_payer",
    })
    .returning();
  if (!customer || !plan) throw new Error("payments fixtures failed");
  await db.insert(subscriptions).values({
    communityId: cid,
    userId: ids.payer,
    customerId: customer.id,
    connectionId: connection.id,
    planId: plan.id,
    externalSubscriptionId: `sub_${newId().slice(-12)}`,
    providerStatus: "active",
    accessState: "granted",
    interval: "month",
    currentPeriodEnd: new Date("2026-11-18T00:00:00Z"),
    applicationFeeBps: 200,
    providerFetchedAt: new Date(),
  });

  ids.spammer = await addUser(db, "spam@cohory.local", "Spam Bot");
  await db.insert(memberships).values({
    communityId: cid,
    userId: ids.spammer,
    status: "banned",
    bannedEmail: "spam@cohory.local",
  });
  ids.applicant = await addUser(db, "applicant@cohory.local", "Applicant");
  await db.insert(membershipRequests).values({
    communityId: cid,
    userId: ids.applicant,
    answers: [{ question: "Why?", answer: "To learn" }],
  });
  const erasedId = newId();
  await db.insert(users).values({
    id: erasedId,
    email: `erased-${erasedId}@erased.invalid`,
    name: "Former member",
    erasedAt: new Date(),
  });
  await db.insert(memberships).values({ communityId: cid, userId: erasedId, status: "removed" });
  await db.insert(comments).values({
    communityId: cid,
    postId,
    authorId: erasedId,
    body: doc({ type: "paragraph", content: [{ type: "text", text: "Old reply" }] }),
    bodyHtml: "<p>Old reply</p>",
    bodyText: "Old reply",
  });
  await db.insert(auditLog).values({
    communityId: cid,
    actorId: ids.owner,
    action: "member.banned",
    target: ids.spammer,
  });
}

async function countWhere(db: Database, table: TenantTable, cid: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.communityId, cid));
  return row?.value ?? 0;
}

const countedTables: readonly (readonly [string, TenantTable])[] = [
  ["posts", posts],
  ["post_images", postImages],
  ["comments", comments],
  ["reactions", reactions],
  ["courses", courses],
  ["course_modules", courseModules],
  ["lessons", lessons],
  ["lesson_progress", lessonProgress],
  ["lesson_agent_layers", lessonAgentLayers],
  ["course_agent_versions", courseAgentVersions],
  ["course_agent_settings", courseAgentSettings],
  ["events", events],
  ["event_occurrences", eventOccurrences],
  ["event_rsvps", eventRsvps],
  ["points_ledger", pointsLedger],
  ["member_stats", memberStats],
  ["invite_links", inviteLinks],
  ["membership_requests", membershipRequests],
  ["reviews", reviews],
  ["review_replies", reviewReplies],
];

async function counts(db: Database, cid: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [name, table] of countedTables) {
    result[name] = await countWhere(db, table, cid);
  }
  return result;
}

async function rolesByEmail(db: Database, cid: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ email: users.email, role: memberships.role, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.communityId, cid)));
  return Object.fromEntries(
    rows
      .filter((row) => !row.email.endsWith("@erased.invalid"))
      .map((row) => [row.email, `${row.role}:${row.status}`]),
  );
}

async function pointsByEmail(db: Database, cid: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ email: users.email, points: memberStats.pointsTotal })
    .from(memberStats)
    .innerJoin(users, eq(users.id, memberStats.userId))
    .where(eq(memberStats.communityId, cid));
  return Object.fromEntries(rows.map((row) => [row.email, row.points]));
}

async function accountsUsed(
  db: Database,
  cid: string,
  userIds: readonly string[],
): Promise<string[]> {
  const found = new Set<string>();
  const memberRows = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.communityId, cid), inArray(memberships.userId, [...userIds])));
  const postRows = await db
    .select({ id: posts.authorId })
    .from(posts)
    .where(and(eq(posts.communityId, cid), inArray(posts.authorId, [...userIds])));
  const commentRows = await db
    .select({ id: comments.authorId })
    .from(comments)
    .where(and(eq(comments.communityId, cid), inArray(comments.authorId, [...userIds])));
  const reviewRows = await db
    .select({ id: reviews.authorId })
    .from(reviews)
    .where(and(eq(reviews.communityId, cid), inArray(reviews.authorId, [...userIds])));
  for (const row of [...memberRows, ...postRows, ...commentRows, ...reviewRows]) {
    if (row.id) found.add(row.id);
  }
  return [...found];
}

async function newOwnedCommunity(db: Database, email: string, slug: string) {
  const ownerId = await addUser(db, email, "New Owner", { emailVerified: true });
  const created = await createCommunityWithOwner(db, {
    ownerUserId: ownerId,
    slug: communitySlugSchema.parse(slug),
    name: "Placeholder",
  });
  if (created.kind !== "created") throw new Error("slug taken");
  return { ownerId, communityId: created.community.id };
}

beforeAll(async () => {
  source = await createScratchDatabase("cohory_mig_src");
  target = await createScratchDatabase("cohory_mig_dst");
  sourceStorage = await storage();
  archives = await storage();
  await seedDevData(source.admin);
  await seedDevPosts(source.admin);
  await seedDevPoints(source.admin);
  await seedDevCourses(source.admin);
  await seedDevEvents(source.admin, new Date("2026-10-18T10:00:00Z"));
  await enrich(source.admin, sourceStorage);

  const exporter = testRuntime(source.probe, {
    archives: archives.driver,
    content: sourceStorage.driver,
  });
  const service = createMigrationService(exporter.deps);
  const job = await service.startExport({ ...owner, userId: ids.owner ?? "" }, sourceCommunityId);
  exportJobId = job.id;
  expect(exporter.queue.sent).toEqual([
    { name: "migration.export", payload: { jobId: job.id, communityId: sourceCommunityId } },
  ]);
  await runExportJob(exporter.runtime, { jobId: job.id, communityId: sourceCommunityId });
  const download = await service.openExport(
    { ...owner, userId: ids.owner ?? "" },
    sourceCommunityId,
    job.id,
  );
  archiveBytes = new Uint8Array(await new Response(download.body).arrayBuffer());
}, 120_000);

afterAll(async () => {
  await source?.close();
  await target?.close();
  for (const store of stores) await store.remove();
});

describe("archive round trip", () => {
  it("exports a versioned archive with every entity and the referenced uploads", async () => {
    const archive = readArchive(archiveBytes, { maxBytes: 50 * 1024 * 1024, maxUploadBytes: 1e7 });

    expect(archive.manifest.schemaVersion).toBe("1.6.0");
    expect(archive.manifest.counts.community_gallery).toBe(2);
    expect(archive.records.community[0]?.detailedDescription).toMatchObject({ type: "doc" });
    expect(
      archive.records.posts.find((post) => post.title === "Coming next week")?.scheduledAt,
    ).toBe("2030-01-15T09:00:00.000Z");
    expect(archive.manifest.community.slug).toBe(devSeed.communitySlug);
    expect(archive.manifest.counts.posts).toBeGreaterThanOrEqual(4);
    expect(archive.manifest.counts.subscriptions).toBe(1);
    expect(archive.uploads.size).toBe(5);
    expect(archive.manifest.counts.lesson_agent_layers).toBe(1);
    expect(archive.manifest.counts.course_agent_versions).toBe(1);
    expect(archive.manifest.counts.course_agent_settings).toBe(1);
    expect(archive.manifest.missingUploads).toEqual([]);
    expect(JSON.stringify(archive.records)).not.toContain("stale html from the source");
    expect(JSON.stringify(archive.records.users)).not.toMatch(/password|hash/i);

    const [job] = await source.admin
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.communityId, sourceCommunityId), eq(auditLog.action, "migration.export")),
      );
    expect(job?.metadata).toMatchObject({ jobId: exportJobId });
  });

  it("restores content, members, progress, RSVPs, points, and entitlements on another instance", async () => {
    const content = await storage();
    const importer = testRuntime(target.probe, {
      archives: archives.driver,
      content: content.driver,
    });
    const service = createMigrationService(importer.deps);
    const { ownerId, communityId } = await newOwnedCommunity(
      target.admin,
      devSeed.email,
      "moved-community",
    );
    const actor = { ...owner, userId: ownerId };

    const uploaded = await service.uploadImport(actor, communityId, {
      bytes: archiveBytes,
      name: "cohory.zip",
    });
    expect(uploaded.status).toBe("ready");
    expect(uploaded.kind === "import" && uploaded.preview?.people).toEqual({
      total: 10,
      existing: 1,
      new: 9,
      keptApart: 0,
      inviteOnly: false,
    });
    await service.confirmImport(actor, communityId, uploaded.id, { notifyNewUsers: true });
    await runImportJob(importer.runtime, { jobId: uploaded.id, communityId });

    const job = await service.getJob(actor, communityId, uploaded.id);
    expect(job.status).toBe("succeeded");
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");
    expect(job.summary.ownerImportedAs).toBe("owner");
    expect(job.summary.users).toEqual({ created: 9, linked: 1, invited: 0 });
    expect(job.summary.skipped).toEqual([]);
    expect(job.summary.subscriptionLinks).toHaveLength(1);
    expect(job.summary.subscriptionLinks[0]).toMatchObject({
      email: "payer@cohory.local",
      externalCustomerId: "cus_payer",
      accessState: "granted",
    });
    expect(importer.mailer.sent.map((mail) => mail.to).sort()).toEqual(
      [
        devAdmin.email,
        devMember.email,
        "payer@cohory.local",
        ...devCreators.map((c) => c.email),
      ].sort(),
    );

    const before = await counts(source.admin, sourceCommunityId);
    const after = await counts(target.admin, communityId);
    expect(after).toEqual(before);

    expect(await rolesByEmail(target.admin, communityId)).toEqual(
      await rolesByEmail(source.admin, sourceCommunityId),
    );
    expect(await pointsByEmail(target.admin, communityId)).toEqual(
      await pointsByEmail(source.admin, sourceCommunityId),
    );

    const [version] = await target.admin
      .select()
      .from(courseAgentVersions)
      .where(eq(courseAgentVersions.communityId, communityId));
    const snapshot = agentSnapshotSchema.parse(version?.snapshot);
    const [movedCourse] = await target.admin
      .select()
      .from(courses)
      .where(eq(courses.communityId, communityId));
    const levels = async (db: Database, id: string) =>
      (
        await db
          .select({ slug: courses.slug, level: courses.requiredLevel })
          .from(courses)
          .where(eq(courses.communityId, id))
      ).sort((a, b) => a.slug.localeCompare(b.slug));
    expect(await levels(target.admin, communityId)).toEqual(
      await levels(source.admin, sourceCommunityId),
    );
    expect((await levels(target.admin, communityId)).map((row) => row.level)).toContain(3);
    const [pointsSettings] = await target.admin
      .select({
        pointsForLessons: communities.pointsForLessons,
        pointsForEvents: communities.pointsForEvents,
      })
      .from(communities)
      .where(eq(communities.id, communityId));
    expect(pointsSettings).toEqual({ pointsForLessons: true, pointsForEvents: true });
    expect(version?.version).toBe("1.0.0");
    expect(snapshot.manifest.course.id).toBe(movedCourse?.id);
    expect(snapshot.manifest.sourceUrl).toBe(
      `https://new.example.test/c/moved-community/classroom/${movedCourse?.slug}`,
    );
    expect(snapshot.lessons[0]?.layer.references[0]?.file.key).toContain(
      `communities/${communityId}/courses/${movedCourse?.id}/agent/`,
    );
    expect(snapshotChecksum(snapshot)).toBe(version?.checksum);

    const [scheduled] = await target.admin
      .select({ scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(and(eq(posts.communityId, communityId), eq(posts.title, "Coming next week")));
    expect(scheduled?.scheduledAt?.toISOString()).toBe("2030-01-15T09:00:00.000Z");

    const memberId = await userId(target.admin, devMember.email);
    const [moved] = await target.admin.select().from(users).where(eq(users.id, memberId));
    expect(moved?.emailVerified).toBe(false);
    const [progress] = await target.admin
      .select({ title: lessons.title, completedAt: lessonProgress.completedAt })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessonProgress.userId, memberId));
    expect(progress?.completedAt?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    const [rsvp] = await target.admin
      .select({ status: eventRsvps.status, title: events.title })
      .from(eventRsvps)
      .innerJoin(eventOccurrences, eq(eventOccurrences.id, eventRsvps.occurrenceId))
      .innerJoin(events, eq(events.id, eventOccurrences.eventId))
      .where(eq(eventRsvps.userId, memberId));
    expect(rsvp?.status).toBe("going");
    const learning = await target.admin
      .select({ sourceType: pointsLedger.sourceType, sourceId: pointsLedger.sourceId })
      .from(pointsLedger)
      .where(and(eq(pointsLedger.userId, memberId), eq(pointsLedger.communityId, communityId)));
    const [movedLesson] = await target.admin
      .select({ id: lessons.id })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessonProgress.userId, memberId));
    const [movedOccurrence] = await target.admin
      .select({ id: eventRsvps.occurrenceId })
      .from(eventRsvps)
      .where(eq(eventRsvps.userId, memberId));
    expect(learning).toEqual(
      expect.arrayContaining([
        { sourceType: "lesson", sourceId: movedLesson?.id },
        { sourceType: "event_occurrence", sourceId: movedOccurrence?.id },
      ]),
    );

    const [post] = await target.admin
      .select()
      .from(posts)
      .where(and(eq(posts.communityId, communityId), eq(posts.title, "Show and tell")));
    if (!post) throw new Error("post missing");
    expect(post.bodyHtml).not.toContain("stale html");
    expect(post.bodyHtml).toContain(`communities/${communityId}/posts/`);
    expect(JSON.stringify(post.body)).toContain(memberId);
    expect(post.commentCount).toBe(3);
    expect(post.likeCount).toBe(1);
    const replies = await target.admin
      .select({ text: comments.bodyText })
      .from(comments)
      .where(and(eq(comments.postId, post.id), isNotNull(comments.parentId)));
    expect(replies.map((reply) => reply.text)).toEqual(["Agreed"]);

    const comps = await target.admin
      .select({
        email: users.email,
        note: compedMemberships.note,
        ends: compedMemberships.expiresAt,
      })
      .from(compedMemberships)
      .innerJoin(users, eq(users.id, compedMemberships.userId))
      .where(eq(compedMemberships.communityId, communityId))
      .orderBy(asc(users.email));
    expect(comps.map((comp) => comp.email)).toEqual([devAdmin.email, "payer@cohory.local"]);
    expect(comps[1]?.note).toMatch(/^Imported paid subscription sub_/);
    expect(comps[1]?.ends?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(await countWhere(target.admin, subscriptions, communityId)).toBe(0);

    const [movedCommunity] = await target.admin
      .select()
      .from(communities)
      .where(eq(communities.id, communityId));
    expect(movedCommunity?.name).toBe(devSeed.communityName);
    expect(movedCommunity?.slug).toBe("moved-community");
    const logoKey = movedCommunity?.appearance.logoKey ?? "";
    expect(logoKey.startsWith(`communities/${communityId}/branding/`)).toBe(true);
    expect(await readStoredFile(content.driver, logoKey)).toEqual(png);
    expect(movedCommunity?.detailedDescription).toEqual(
      doc({ type: "paragraph", content: [{ type: "text", text: "Weekly build nights" }] }),
    );
    const gallery = await target.admin
      .select()
      .from(communityGalleryItems)
      .where(eq(communityGalleryItems.communityId, communityId))
      .orderBy(asc(communityGalleryItems.position));
    expect(gallery.map((item) => [item.kind, item.position, item.altText])).toEqual([
      ["video_embed", 0, null],
      ["image", 1, "Build night"],
    ]);
    const galleryKey = gallery[1]?.storageKey ?? "";
    expect(galleryKey.startsWith(`communities/${communityId}/gallery/`)).toBe(true);
    expect(await readStoredFile(content.driver, galleryKey)).toEqual(png);
    const [lesson] = await target.admin
      .select({ attachments: lessons.attachments, courseId: lessons.courseId })
      .from(lessons)
      .where(and(eq(lessons.communityId, communityId)))
      .orderBy(asc(lessons.position), asc(lessons.title))
      .limit(1);
    const attachment = lesson?.attachments[0];
    expect(
      attachment?.key.startsWith(`communities/${communityId}/courses/${lesson?.courseId}/`),
    ).toBe(true);
    expect(await readStoredFile(content.driver, attachment?.key ?? "")).toEqual(pdf);

    const actions = await target.admin
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.communityId, communityId));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(["member.banned", "migration.import"]),
    );
  });

  it("on the Community Edition links existing accounts with a confirmed email and keeps the others apart", async () => {
    const content = await storage();
    const importer = testRuntime(source.probe, {
      archives: archives.driver,
      content: content.driver,
    });
    const service = createMigrationService(importer.deps);
    const { ownerId, communityId } = await newOwnedCommunity(
      source.admin,
      "copy-owner@cohory.local",
      "cohory-copy",
    );
    const actor = { ...owner, userId: ownerId };
    const uploaded = await service.uploadImport(actor, communityId, {
      bytes: archiveBytes,
      name: "copy.zip",
    });
    expect(uploaded.kind === "import" && uploaded.preview?.people).toEqual({
      total: 10,
      existing: 8,
      new: 2,
      keptApart: 2,
      inviteOnly: false,
    });
    await service.confirmImport(actor, communityId, uploaded.id, {});
    await runImportJob(importer.runtime, { jobId: uploaded.id, communityId });
    const job = await service.getJob(actor, communityId, uploaded.id);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");

    expect(job.summary.users).toEqual({ created: 0, linked: 8, invited: 2 });
    expect(job.summary.ownerImportedAs).toBe("admin");
    expect(job.summary.renamedInviteLinks).toBe(1);
    const renamed = await source.admin
      .select({ token: inviteLinks.token })
      .from(inviteLinks)
      .where(eq(inviteLinks.communityId, communityId));
    expect(renamed.map((row) => row.token)).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)]);
    expect(importer.mailer.sent).toEqual([]);
    expect(await counts(source.admin, communityId)).toEqual(
      await counts(source.admin, sourceCommunityId),
    );
    const roles = await rolesByEmail(source.admin, communityId);
    expect(roles[devSeed.email]).toBe("admin:active");
    expect(roles["copy-owner@cohory.local"]).toBe("owner:active");
    expect(roles["spam@cohory.local"]).toBeUndefined();
    expect(
      await accountsUsed(source.admin, communityId, [ids.spammer ?? "", ids.applicant ?? ""]),
    ).toEqual([]);
  });

  it("on the Cloud Edition never links an archive person to someone else's account", async () => {
    const content = await storage();
    const importer = testRuntime(
      source.probe,
      { archives: archives.driver, content: content.driver },
      "cloud",
    );
    const service = createMigrationService(importer.deps);
    const created = await createCommunityWithOwner(source.admin, {
      ownerUserId: ids.owner ?? "",
      slug: communitySlugSchema.parse(`cloud-copy-${newId().slice(-8)}`),
      name: "Placeholder",
    });
    if (created.kind !== "created") throw new Error("slug taken");
    const communityId = created.community.id;
    const actor = { ...owner, userId: ids.owner ?? "" };
    const uploaded = await service.uploadImport(actor, communityId, {
      bytes: archiveBytes,
      name: "cloud.zip",
    });
    expect(uploaded.kind === "import" && uploaded.preview?.people).toEqual({
      total: 10,
      existing: 1,
      new: 9,
      keptApart: 9,
      inviteOnly: true,
    });
    await service.confirmImport(actor, communityId, uploaded.id, { emailChoice: "now" });
    await runImportJob(importer.runtime, { jobId: uploaded.id, communityId });
    const job = await service.getJob(actor, communityId, uploaded.id);
    if (job.kind !== "import" || !job.summary) throw new Error("no summary");

    expect(job.summary.users).toEqual({ created: 0, linked: 1, invited: 9 });
    expect(job.summary.ownerImportedAs).toBe("owner");
    expect(job.summary.emailsSent).toBe(7);
    const invited = await source.admin
      .select({ token: inviteLinks.token, maxUses: inviteLinks.maxUses })
      .from(inviteLinks)
      .where(and(eq(inviteLinks.communityId, communityId), eq(inviteLinks.maxUses, 1)));
    expect(invited).toHaveLength(7);
    const sentTo = importer.mailer.sent.map((mail) => mail.to).sort();
    expect(sentTo).toContain(devAdmin.email);
    expect(sentTo).not.toContain(devSeed.email);
    for (const mail of importer.mailer.sent) {
      expect(mail.text).toMatch(/\/join\/[A-Za-z0-9_-]{43}/);
      expect(mail.communityId).toBe(communityId);
      expect(mail.text).toContain("Don't email me about");
      expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    const others = [ids.member, ids.admin, ids.payer, ids.spammer, ids.applicant].map(
      (id) => id ?? "",
    );
    expect(await accountsUsed(source.admin, communityId, others)).toEqual([]);
    const placeholders = await source.admin
      .select({ email: users.email, name: users.name, verified: users.emailVerified })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.communityId, communityId), eq(memberships.role, "admin")));
    expect(placeholders).toEqual([
      {
        email: expect.stringMatching(/^imported-.+@import\.invalid$/),
        name: devAdmin.name,
        verified: false,
      },
    ]);
    const copied = await counts(source.admin, communityId);
    expect({ ...copied, invite_links: (copied.invite_links ?? 0) - 7 }).toEqual(
      await counts(source.admin, sourceCommunityId),
    );
  });

  it("continues without duplicates when the same import job runs again", async () => {
    const content = await storage();
    const { runtime } = testRuntime(target.probe, {
      archives: archives.driver,
      content: content.driver,
    });
    const { ownerId, communityId } = await newOwnedCommunity(
      target.admin,
      `retry-${newId().slice(-6)}@cohory.local`,
      `retry-${newId().slice(-8)}`,
    );
    const archive = readArchive(archiveBytes, { maxBytes: 50 * 1024 * 1024, maxUploadBytes: 1e7 });
    const job = await runtime.jobs.create(communityId, {
      kind: "import",
      status: "running",
      requestedBy: ownerId,
    });
    const input = { jobId: job.id, communityId, ownerUserId: ownerId, archive };
    const deps = {
      db: target.probe,
      storage: content.driver,
      now: () => new Date(),
      edition: "community" as const,
    };

    const first = await restoreArchive(deps, input);
    const firstCounts = await counts(target.admin, communityId);
    const second = await restoreArchive(deps, input);

    expect(await counts(target.admin, communityId)).toEqual(firstCounts);
    expect(second.imported).toEqual(first.imported);
    expect((await IdMap.load(target.probe, communityId, job.id)).count("posts")).toBe(
      archive.records.posts.length,
    );
  });

  it("keeps a paying member's free access for a week when the paid period already ended", async () => {
    const content = await storage();
    const { runtime } = testRuntime(target.probe, {
      archives: archives.driver,
      content: content.driver,
    });
    const { ownerId, communityId } = await newOwnedCommunity(
      target.admin,
      `late-${newId().slice(-6)}@cohory.local`,
      `late-${newId().slice(-8)}`,
    );
    const archive = readArchive(archiveBytes, { maxBytes: 50 * 1024 * 1024, maxUploadBytes: 1e7 });
    const job = await runtime.jobs.create(communityId, {
      kind: "import",
      status: "running",
      requestedBy: ownerId,
    });
    const restoredAt = new Date("2026-12-01T09:00:00.000Z");

    await restoreArchive(
      { db: target.probe, storage: content.driver, now: () => restoredAt, edition: "community" },
      { jobId: job.id, communityId, ownerUserId: ownerId, archive },
    );

    const [comp] = await target.admin
      .select({ ends: compedMemberships.expiresAt })
      .from(compedMemberships)
      .where(
        and(
          eq(compedMemberships.communityId, communityId),
          like(compedMemberships.note, "Imported paid subscription%"),
        ),
      );
    expect(comp?.ends?.toISOString()).toBe("2026-12-08T09:00:00.000Z");
  });

  it("refuses to import into a community that already has content", async () => {
    const content = await storage();
    const importer = testRuntime(source.probe, {
      archives: archives.driver,
      content: content.driver,
    });
    const service = createMigrationService(importer.deps);

    await expect(
      service.uploadImport({ ...owner, userId: ids.owner ?? "" }, sourceCommunityId, {
        bytes: archiveBytes,
        name: "again.zip",
      }),
    ).rejects.toMatchObject({ code: "community_not_empty" });
  });

  it("lets only the owner export or import", async () => {
    const importer = testRuntime(source.probe, {
      archives: archives.driver,
      content: archives.driver,
    });
    const service = createMigrationService(importer.deps);

    await expect(
      service.startExport({ ...owner, userId: ids.member ?? "" }, sourceCommunityId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.uploadImport({ ...owner, userId: ids.admin ?? "" }, sourceCommunityId, {
        bytes: archiveBytes,
        name: "x.zip",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.listJobs({ ...owner, userId: ids.applicant ?? "" }, sourceCommunityId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(service.listJobs({ kind: "guest" }, sourceCommunityId)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
