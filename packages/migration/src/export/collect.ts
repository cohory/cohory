import {
  agentLessonLayerSchema,
  agentSnapshotSchema,
  storedFiles,
} from "@cohory/courses/agent-format";
import type { Database } from "@cohory/db";
import {
  auditLog,
  categories,
  comments,
  communities,
  communityGalleryItems,
  compedMemberships,
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
  paymentCustomers,
  pointsLedger,
  postImages,
  posts,
  reactions,
  reviewReplies,
  reviews,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

import type { ArchiveRecords, UserRecord } from "../format/records";
import { inMigrationScope } from "../scope";

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);
const userBatch = 1000;

export interface CollectedCommunity {
  readonly records: ArchiveRecords;
  readonly uploadKeys: readonly string[];
}

function licenseIdOf(value: string): "personal_agents" | "team_agents" | "custom" {
  return value === "team_agents" || value === "custom" ? value : "personal_agents";
}

function agentFileKeys(records: Omit<ArchiveRecords, "users">): string[] {
  const keys: string[] = [];
  for (const row of records.lesson_agent_layers) {
    const layer = agentLessonLayerSchema.safeParse(row.layer);
    if (!layer.success) continue;
    for (const reference of layer.data.references) keys.push(reference.file.key);
    for (const template of layer.data.templates) {
      if (template.kind === "file") keys.push(template.file.key);
    }
  }
  for (const row of records.course_agent_versions) {
    const snapshot = agentSnapshotSchema.safeParse(row.snapshot);
    if (snapshot.success) keys.push(...storedFiles(snapshot.data).map(({ file }) => file.key));
  }
  return keys;
}

function uploadKeysOf(records: Omit<ArchiveRecords, "users">): string[] {
  const keys = new Set<string>();
  const [community] = records.community;
  for (const key of [community?.appearance.logoKey, community?.appearance.coverKey]) {
    if (key) keys.add(key);
  }
  for (const item of records.community_gallery) {
    if (item.storageKey) keys.add(item.storageKey);
  }
  for (const course of records.courses) {
    if (course.coverKey) keys.add(course.coverKey);
  }
  for (const lesson of records.lessons) {
    for (const attachment of lesson.attachments) keys.add(attachment.key);
  }
  for (const image of records.post_images) keys.add(image.storageKey);
  for (const key of agentFileKeys(records)) keys.add(key);
  return [...keys].sort();
}

function referencedUsers(records: Omit<ArchiveRecords, "users">): string[] {
  const ids = new Set<string>();
  const add = (id: string | null) => {
    if (id) ids.add(id);
  };
  records.memberships.forEach((row) => add(row.userId));
  records.posts.forEach((row) => {
    add(row.authorId);
    add(row.deletedBy);
  });
  records.comments.forEach((row) => {
    add(row.authorId);
    add(row.deletedBy);
  });
  records.reactions.forEach((row) => {
    add(row.userId);
    add(row.subjectAuthorId);
  });
  records.lesson_progress.forEach((row) => add(row.userId));
  records.event_rsvps.forEach((row) => add(row.userId));
  records.points_ledger.forEach((row) => add(row.userId));
  records.member_stats.forEach((row) => add(row.userId));
  records.subscriptions.forEach((row) => add(row.userId));
  records.comped_memberships.forEach((row) => {
    add(row.userId);
    add(row.grantedBy);
    add(row.endedBy);
  });
  records.invite_links.forEach((row) => add(row.createdBy));
  records.membership_requests.forEach((row) => {
    add(row.userId);
    add(row.decidedBy);
  });
  records.reviews.forEach((row) => {
    add(row.authorId);
    add(row.hiddenBy);
  });
  records.review_replies.forEach((row) => add(row.authorId));
  records.audit_log.forEach((row) => add(row.actorId));
  return [...ids].sort();
}

export async function collectCommunity(
  db: Database,
  communityId: string,
): Promise<CollectedCommunity> {
  return inMigrationScope(db, communityId, async ({ tx, where }) => {
    const [community] = await tx.select().from(communities).where(eq(communities.id, communityId));
    if (!community) {
      throw new Error("community not found");
    }

    const membershipRows = await tx
      .select()
      .from(memberships)
      .where(where(memberships))
      .orderBy(asc(memberships.createdAt), asc(memberships.id));
    const categoryRows = await tx
      .select()
      .from(categories)
      .where(where(categories))
      .orderBy(asc(categories.position));
    const postRows = await tx
      .select()
      .from(posts)
      .where(where(posts))
      .orderBy(asc(posts.createdAt), asc(posts.id));
    const exportedPosts = new Set(postRows.map((row) => row.id));
    const imageRows = (await tx.select().from(postImages).where(where(postImages))).filter((row) =>
      exportedPosts.has(row.postId),
    );
    const commentRows = await tx
      .select()
      .from(comments)
      .where(where(comments))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    const reactionRows = await tx.select().from(reactions).where(where(reactions));
    const courseRows = await tx
      .select()
      .from(courses)
      .where(where(courses))
      .orderBy(asc(courses.position));
    const moduleRows = await tx
      .select()
      .from(courseModules)
      .where(where(courseModules))
      .orderBy(asc(courseModules.position));
    const lessonRows = await tx
      .select({
        id: lessons.id,
        courseId: lessons.courseId,
        moduleId: lessons.moduleId,
        slug: lessons.slug,
        title: lessons.title,
        bodyMarkdown: lessons.bodyMarkdown,
        videoUrl: lessons.videoUrl,
        attachments: lessons.attachments,
        status: lessons.status,
        position: lessons.position,
        createdAt: lessons.createdAt,
        updatedAt: lessons.updatedAt,
      })
      .from(lessons)
      .where(where(lessons))
      .orderBy(asc(lessons.position));
    const progressRows = await tx.select().from(lessonProgress).where(where(lessonProgress));
    const agentLayerRows = await tx
      .select()
      .from(lessonAgentLayers)
      .where(where(lessonAgentLayers))
      .orderBy(asc(lessonAgentLayers.lessonId));
    const agentSettingsRows = await tx
      .select()
      .from(courseAgentSettings)
      .where(where(courseAgentSettings))
      .orderBy(asc(courseAgentSettings.courseId));
    const agentVersionRows = await tx
      .select()
      .from(courseAgentVersions)
      .where(where(courseAgentVersions))
      .orderBy(
        asc(courseAgentVersions.courseId),
        asc(courseAgentVersions.major),
        asc(courseAgentVersions.minor),
        asc(courseAgentVersions.patch),
      );
    const eventRows = await tx.select().from(events).where(where(events));
    const occurrenceRows = await tx
      .select()
      .from(eventOccurrences)
      .where(where(eventOccurrences))
      .orderBy(asc(eventOccurrences.startsAt));
    const rsvpRows = await tx.select().from(eventRsvps).where(where(eventRsvps));
    const ledgerRows = await tx
      .select()
      .from(pointsLedger)
      .where(where(pointsLedger))
      .orderBy(asc(pointsLedger.occurredAt), asc(pointsLedger.id));
    const statsRows = await tx.select().from(memberStats).where(where(memberStats));
    const planRows = await tx.select().from(membershipPlans).where(where(membershipPlans));
    const subscriptionRows = await tx
      .select({
        subscription: subscriptions,
        externalCustomerId: paymentCustomers.externalCustomerId,
      })
      .from(subscriptions)
      .innerJoin(paymentCustomers, eq(paymentCustomers.id, subscriptions.customerId))
      .where(where(subscriptions));
    const compRows = await tx.select().from(compedMemberships).where(where(compedMemberships));
    const inviteRows = await tx.select().from(inviteLinks).where(where(inviteLinks));
    const galleryRows = await tx
      .select()
      .from(communityGalleryItems)
      .where(where(communityGalleryItems))
      .orderBy(asc(communityGalleryItems.position), asc(communityGalleryItems.id));
    const requestRows = await tx.select().from(membershipRequests).where(where(membershipRequests));
    const reviewRows = await tx
      .select()
      .from(reviews)
      .where(where(reviews))
      .orderBy(asc(reviews.createdAt), asc(reviews.id));
    const replyRows = await tx.select().from(reviewReplies).where(where(reviewReplies));
    const auditRows = await tx
      .select()
      .from(auditLog)
      .where(where(auditLog))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

    const withoutUsers: Omit<ArchiveRecords, "users"> = {
      community: [
        {
          id: community.id,
          slug: community.slug,
          name: community.name,
          description: community.description,
          privacy: community.privacy,
          joinMode: community.joinMode,
          joinQuestions: community.joinQuestions,
          appearance: community.appearance,
          gamificationEnabled: community.gamificationEnabled,
          reviewsEnabled: community.reviewsEnabled,
          pointsForLessons: community.pointsForLessons,
          pointsForEvents: community.pointsForEvents,
          levelNames: community.levelNames,
          detailedDescription: community.detailedDescription
            ? { type: "doc", content: [...community.detailedDescription.content] }
            : null,
          archivedAt: isoOrNull(community.archivedAt),
          createdAt: iso(community.createdAt),
        },
      ],
      community_gallery: galleryRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        storageKey: row.storageKey,
        embedUrl: row.embedUrl,
        position: row.position,
        altText: row.altText,
        createdAt: iso(row.createdAt),
      })),
      memberships: membershipRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        role: row.role,
        status: row.status,
        bio: row.bio,
        joinAnswers: row.joinAnswers,
        bannedEmail: row.bannedEmail,
        joinedAt: isoOrNull(row.joinedAt),
        lastSeenAt: isoOrNull(row.lastSeenAt),
        createdAt: iso(row.createdAt),
      })),
      categories: categoryRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        position: row.position,
        staffOnly: row.staffOnly,
        createdAt: iso(row.createdAt),
      })),
      posts: postRows.map((row) => ({
        id: row.id,
        authorId: row.authorId,
        categoryId: row.categoryId,
        title: row.title,
        body: { type: "doc", content: [...row.body.content] },
        pinnedAt: isoOrNull(row.pinnedAt),
        scheduledAt: isoOrNull(row.scheduledAt),
        editedAt: isoOrNull(row.editedAt),
        deletedAt: isoOrNull(row.deletedAt),
        deletedBy: row.deletedBy,
        lastActivityAt: iso(row.lastActivityAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
      post_images: imageRows.map((row) => ({
        id: row.id,
        postId: row.postId,
        storageKey: row.storageKey,
        width: row.width,
        height: row.height,
        position: row.position,
      })),
      comments: commentRows.map((row) => ({
        id: row.id,
        postId: row.postId,
        parentId: row.parentId,
        authorId: row.authorId,
        body: { type: "doc", content: [...row.body.content] },
        editedAt: isoOrNull(row.editedAt),
        deletedAt: isoOrNull(row.deletedAt),
        deletedBy: row.deletedBy,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
      reactions: reactionRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subjectAuthorId: row.subjectAuthorId,
        kind: row.kind,
        createdAt: iso(row.createdAt),
      })),
      courses: courseRows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        coverKey: row.coverKey,
        status: row.status,
        position: row.position,
        access: "all_members" as const,
        requiredLevel: row.requiredLevel,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
      course_modules: moduleRows.map((row) => ({
        id: row.id,
        courseId: row.courseId,
        title: row.title,
        position: row.position,
      })),
      lessons: lessonRows.map((row) => ({
        ...row,
        attachments: row.attachments.map((attachment) => ({ ...attachment })),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
      lesson_agent_layers: agentLayerRows.map((row) => ({
        lessonId: row.lessonId,
        courseId: row.courseId,
        layer: row.layer,
        updatedAt: iso(row.updatedAt),
      })),
      course_agent_versions: agentVersionRows.map((row) => ({
        id: row.id,
        courseId: row.courseId,
        version: row.version,
        major: row.major,
        minor: row.minor,
        patch: row.patch,
        changelog: row.changelog,
        snapshot: row.snapshot,
        checksum: row.checksum,
        createdAt: iso(row.createdAt),
      })),
      course_agent_settings: agentSettingsRows.map((row) => ({
        courseId: row.courseId,
        allowAgentAccess: row.allowAgentAccess,
        licenseId: licenseIdOf(row.licenseId),
        licenseText: row.licenseText,
        updatedAt: iso(row.updatedAt),
      })),
      lesson_progress: progressRows.map((row) => ({
        lessonId: row.lessonId,
        courseId: row.courseId,
        userId: row.userId,
        completedAt: isoOrNull(row.completedAt),
        lastViewedAt: iso(row.lastViewedAt),
      })),
      events: eventRows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        startsAtLocal: row.startsAtLocal,
        timeZone: row.timeZone,
        durationMinutes: row.durationMinutes,
        recurrence: row.recurrence === "weekly" ? ("weekly" as const) : null,
        recurrenceUntil: row.recurrenceUntil,
        location: row.location,
        recordingUrl: row.recordingUrl,
        createdAt: iso(row.createdAt),
      })),
      event_occurrences: occurrenceRows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
        canceledAt: isoOrNull(row.canceledAt),
      })),
      event_rsvps: rsvpRows.map((row) => ({
        occurrenceId: row.occurrenceId,
        userId: row.userId,
        status: row.status,
        reminderSentAt: isoOrNull(row.reminderSentAt),
      })),
      points_ledger: ledgerRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        delta: row.delta,
        reason: row.reason,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        occurredAt: iso(row.occurredAt),
      })),
      member_stats: statsRows.map((row) => ({
        userId: row.userId,
        pointsTotal: row.pointsTotal,
        level: row.level,
        updatedAt: iso(row.updatedAt),
      })),
      membership_plans: planRows.map((row) => ({
        id: row.id,
        name: row.name,
        currency: row.currency,
        monthlyPriceMinor: row.monthlyPriceMinor,
        annualPriceMinor: row.annualPriceMinor,
        providerProductId: row.providerProductId,
        providerMonthlyPriceId: row.providerMonthlyPriceId,
        providerAnnualPriceId: row.providerAnnualPriceId,
        archivedAt: isoOrNull(row.archivedAt),
      })),
      subscriptions: subscriptionRows.map(({ subscription: row, externalCustomerId }) => ({
        id: row.id,
        userId: row.userId,
        planId: row.planId,
        externalSubscriptionId: row.externalSubscriptionId,
        externalCustomerId,
        providerStatus: row.providerStatus,
        accessState: row.accessState,
        interval: row.interval,
        currentPeriodEnd: isoOrNull(row.currentPeriodEnd),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        endedAt: isoOrNull(row.endedAt),
        origin: row.origin,
      })),
      comped_memberships: compRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        grantedBy: row.grantedBy,
        note: row.note,
        expiresAt: isoOrNull(row.expiresAt),
        endedAt: isoOrNull(row.endedAt),
        endReason: row.endReason,
        endedBy: row.endedBy,
        createdAt: iso(row.createdAt),
      })),
      invite_links: inviteRows.map((row) => ({
        id: row.id,
        token: row.token,
        createdBy: row.createdBy,
        expiresAt: isoOrNull(row.expiresAt),
        maxUses: row.maxUses,
        useCount: row.useCount,
        requiresApproval: row.requiresApproval,
        revokedAt: isoOrNull(row.revokedAt),
        createdAt: iso(row.createdAt),
      })),
      membership_requests: requestRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        status: row.status,
        answers: row.answers.map((answer) => ({ ...answer })),
        decisionNote: row.decisionNote,
        decidedBy: row.decidedBy,
        decidedAt: isoOrNull(row.decidedAt),
        createdAt: iso(row.createdAt),
      })),
      reviews: reviewRows.map((row) => ({
        id: row.id,
        authorId: row.anonymizedAt ? null : row.authorId,
        rating: row.rating,
        body: row.body,
        editedAt: isoOrNull(row.editedAt),
        hiddenAt: isoOrNull(row.hiddenAt),
        hiddenReason: row.hiddenReason,
        hiddenBy: row.hiddenBy,
        authorRemovedAt: isoOrNull(row.authorRemovedAt),
        anonymizedAt: isoOrNull(row.anonymizedAt),
        createdAt: iso(row.createdAt),
      })),
      review_replies: replyRows.map((row) => ({
        id: row.id,
        reviewId: row.reviewId,
        authorId: row.authorId,
        body: row.body,
        editedAt: isoOrNull(row.editedAt),
        createdAt: iso(row.createdAt),
      })),
      audit_log: auditRows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        target: row.target,
        metadata: row.metadata,
        createdAt: iso(row.createdAt),
      })),
    };

    const userIds = referencedUsers(withoutUsers);
    const userRows: UserRecord[] = [];
    for (let start = 0; start < userIds.length; start += userBatch) {
      const batch = await tx
        .select()
        .from(users)
        .where(inArray(users.id, userIds.slice(start, start + userBatch)))
        .orderBy(asc(users.id));
      for (const row of batch) {
        userRows.push({
          id: row.id,
          email: row.email,
          name: row.name,
          username: row.username,
          emailVerified: row.emailVerified,
          erased: row.erasedAt !== null,
          createdAt: iso(row.createdAt),
        });
      }
    }
    return {
      records: { ...withoutUsers, users: userRows },
      uploadKeys: uploadKeysOf(withoutUsers),
    };
  });
}
