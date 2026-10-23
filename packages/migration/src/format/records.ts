import { z } from "zod";

const uuid = z.uuid();
const nullableUuid = uuid.nullable();
const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();
const text = (max: number) => z.string().max(max);
const position = z.int().min(0).max(1_000_000);
const contentDocument = z.object({ type: z.literal("doc"), content: z.array(z.unknown()) });
const storageKey = z.string().min(1).max(512);

export const communityRecord = z.object({
  id: uuid,
  slug: text(64),
  name: z.string().min(1).max(120),
  description: text(2000).nullable(),
  privacy: z.enum(["private", "public"]),
  joinMode: z.enum(["open", "approval", "invite"]),
  joinQuestions: z
    .array(z.object({ text: z.string().min(1).max(200), required: z.boolean() }))
    .max(3)
    .nullable(),
  appearance: z.object({
    accent: z.string().max(16).nullable().optional(),
    logoKey: storageKey.nullable().optional(),
    coverKey: storageKey.nullable().optional(),
    font: z.enum(["inter", "source-serif", "nunito-sans"]).optional(),
    cardStyle: z.enum(["minimal", "soft"]).optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
  }),
  gamificationEnabled: z.boolean(),
  reviewsEnabled: z.boolean().optional(),
  pointsForLessons: z.boolean().optional(),
  pointsForEvents: z.boolean().optional(),
  levelNames: z.array(z.string().min(1).max(40)).length(9),
  detailedDescription: contentDocument.nullish().transform((doc) => doc ?? null),
  archivedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const communityGalleryRecord = z.object({
  id: uuid,
  kind: z.enum(["image", "video_embed"]),
  storageKey: storageKey.nullable(),
  embedUrl: z.string().max(2048).nullable(),
  position,
  altText: text(250).nullable(),
  createdAt: timestamp,
});

export const userRecord = z.object({
  id: uuid,
  email: z.string().min(3).max(254),
  name: z.string().min(1).max(200),
  username: text(64).nullable(),
  emailVerified: z.boolean(),
  erased: z.boolean(),
  createdAt: timestamp,
});

export const membershipRecord = z.object({
  id: uuid,
  userId: uuid,
  role: z.enum(["owner", "admin", "moderator", "member"]),
  status: z.enum(["pending", "active", "removed", "banned"]),
  bio: text(500).nullable(),
  joinAnswers: z
    .union([
      z.array(z.string().max(1000)).max(3),
      z.array(z.object({ question: z.string().max(200), answer: z.string().max(1000) })).max(3),
    ])
    .nullable(),
  bannedEmail: text(254).nullable(),
  joinedAt: nullableTimestamp,
  lastSeenAt: nullableTimestamp,
  createdAt: timestamp,
});

export const categoryRecord = z.object({
  id: uuid,
  name: z.string().min(1).max(40),
  slug: z.string().min(1).max(64),
  color: z.enum(["neutral", "accent", "info", "success", "warning", "danger"]),
  position,
  staffOnly: z.boolean(),
  createdAt: timestamp,
});

export const postRecord = z.object({
  id: uuid,
  authorId: uuid,
  categoryId: nullableUuid,
  title: text(120).nullable(),
  body: contentDocument,
  pinnedAt: nullableTimestamp,
  scheduledAt: nullableTimestamp.optional(),
  editedAt: nullableTimestamp,
  deletedAt: nullableTimestamp,
  deletedBy: nullableUuid,
  lastActivityAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const postImageRecord = z.object({
  id: uuid,
  postId: uuid,
  storageKey,
  width: z.int().min(1).max(20_000).nullable(),
  height: z.int().min(1).max(20_000).nullable(),
  position: z.int().min(0).max(9),
});

export const commentRecord = z.object({
  id: uuid,
  postId: uuid,
  parentId: nullableUuid,
  authorId: uuid,
  body: contentDocument,
  editedAt: nullableTimestamp,
  deletedAt: nullableTimestamp,
  deletedBy: nullableUuid,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const reactionRecord = z.object({
  id: uuid,
  userId: uuid,
  subjectType: z.enum(["post", "comment"]),
  subjectId: uuid,
  subjectAuthorId: uuid,
  kind: z.literal("like"),
  createdAt: timestamp,
});

export const courseRecord = z.object({
  id: uuid,
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  description: text(2000).nullable(),
  coverKey: storageKey.nullable(),
  status: z.enum(["draft", "published", "archived"]),
  position,
  access: z.literal("all_members"),
  requiredLevel: z.int().min(1).max(9).nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const courseModuleRecord = z.object({
  id: uuid,
  courseId: uuid,
  title: z.string().min(1).max(120),
  position,
});

export const lessonAttachmentRecord = z.object({
  key: storageKey,
  name: z.string().min(1).max(255),
  size: z.int().min(0),
  contentType: z.string().min(1).max(120),
});

export const lessonRecord = z.object({
  id: uuid,
  courseId: uuid,
  moduleId: uuid,
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  bodyMarkdown: text(100_000).nullable(),
  videoUrl: text(2048).nullable(),
  attachments: z.array(lessonAttachmentRecord).max(10),
  status: z.enum(["draft", "published"]),
  position,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const semver = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/);

export const lessonAgentLayerRecord = z.object({
  lessonId: uuid,
  courseId: uuid,
  layer: z.record(z.string(), z.unknown()),
  updatedAt: timestamp,
});

export const courseAgentVersionRecord = z.object({
  id: uuid,
  courseId: uuid,
  version: semver,
  major: z.int().min(0),
  minor: z.int().min(0),
  patch: z.int().min(0),
  changelog: text(2000),
  snapshot: z.record(z.string(), z.unknown()),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: timestamp,
});

export const courseAgentSettingsRecord = z.object({
  courseId: uuid,
  allowAgentAccess: z.boolean(),
  licenseId: z.enum(["personal_agents", "team_agents", "custom"]),
  licenseText: text(2000).nullable(),
  updatedAt: timestamp,
});

export const lessonProgressRecord = z.object({
  lessonId: uuid,
  courseId: uuid,
  userId: uuid,
  completedAt: nullableTimestamp,
  lastViewedAt: timestamp,
});

const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/);

export const eventRecord = z.object({
  id: uuid,
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  description: text(5000).nullable(),
  startsAtLocal: wallClock,
  timeZone: z.string().min(1).max(64),
  durationMinutes: z.int().min(5).max(1440),
  recurrence: z.literal("weekly").nullable(),
  recurrenceUntil: z.iso.date().nullable(),
  location: text(500).nullable(),
  recordingUrl: text(2000).nullable(),
  createdAt: timestamp,
});

export const eventOccurrenceRecord = z.object({
  id: uuid,
  eventId: uuid,
  startsAt: timestamp,
  endsAt: timestamp,
  canceledAt: nullableTimestamp,
});

export const eventRsvpRecord = z.object({
  occurrenceId: uuid,
  userId: uuid,
  status: z.enum(["going", "not_going"]),
  reminderSentAt: nullableTimestamp,
});

export const pointsLedgerRecord = z.object({
  id: uuid,
  userId: uuid,
  delta: z
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((value) => value !== 0),
  reason: z.enum([
    "like_received",
    "like_removed",
    "post_deleted",
    "comment_deleted",
    "admin_reset",
    "lesson_completed",
    "event_attended",
  ]),
  sourceType: text(40).nullable(),
  sourceId: nullableUuid,
  occurredAt: timestamp,
});

export const memberStatsRecord = z.object({
  userId: uuid,
  pointsTotal: z.int(),
  level: z.int().min(1).max(9),
  updatedAt: timestamp,
});

const currency = z.string().regex(/^[a-z]{3}$/);
const minor = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const membershipPlanRecord = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  currency,
  monthlyPriceMinor: minor,
  annualPriceMinor: minor.nullable(),
  providerProductId: text(255).nullable(),
  providerMonthlyPriceId: text(255).nullable(),
  providerAnnualPriceId: text(255).nullable(),
  archivedAt: nullableTimestamp,
});

export const subscriptionRecord = z.object({
  id: uuid,
  userId: uuid,
  planId: nullableUuid,
  externalSubscriptionId: z.string().min(1).max(255),
  externalCustomerId: z.string().min(1).max(255),
  providerStatus: z.string().min(1).max(40),
  accessState: z.enum(["none", "granted", "grace", "revoked"]),
  interval: z.enum(["month", "year"]).nullable(),
  currentPeriodEnd: nullableTimestamp,
  cancelAtPeriodEnd: z.boolean(),
  endedAt: nullableTimestamp,
  origin: z.string().min(1).max(40),
});

export const compedMembershipRecord = z.object({
  id: uuid,
  userId: uuid,
  grantedBy: nullableUuid,
  note: text(200).nullable(),
  expiresAt: nullableTimestamp,
  endedAt: nullableTimestamp,
  endReason: z.enum(["revoked", "expired"]).nullable(),
  endedBy: nullableUuid,
  createdAt: timestamp,
});

export const inviteLinkRecord = z.object({
  id: uuid,
  token: z.string().min(16).max(200),
  createdBy: uuid,
  expiresAt: nullableTimestamp,
  maxUses: z.int().min(1).nullable(),
  useCount: z.int().min(0),
  requiresApproval: z.boolean(),
  revokedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const membershipRequestRecord = z.object({
  id: uuid,
  userId: uuid,
  status: z.enum(["pending", "approved", "declined"]),
  answers: z
    .array(z.object({ question: z.string().max(200), answer: z.string().max(1000) }))
    .max(3),
  decisionNote: text(500).nullable(),
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const auditLogRecord = z.object({
  id: uuid,
  actorId: nullableUuid,
  action: z.string().min(1).max(120),
  target: text(500).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestamp,
});

export const reviewRecord = z.object({
  id: uuid,
  authorId: nullableUuid,
  rating: z.int().min(1).max(5),
  body: z.string().min(20).max(2000),
  editedAt: nullableTimestamp,
  hiddenAt: nullableTimestamp,
  hiddenReason: z.enum(["spam", "abuse", "personal_data", "off_topic"]).nullable(),
  hiddenBy: nullableUuid,
  authorRemovedAt: nullableTimestamp,
  anonymizedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const reviewReplyRecord = z.object({
  id: uuid,
  reviewId: uuid,
  authorId: nullableUuid,
  body: z.string().min(1).max(2000),
  editedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const entitySchemas = {
  community: communityRecord,
  community_gallery: communityGalleryRecord,
  users: userRecord,
  memberships: membershipRecord,
  categories: categoryRecord,
  posts: postRecord,
  post_images: postImageRecord,
  comments: commentRecord,
  reactions: reactionRecord,
  courses: courseRecord,
  course_modules: courseModuleRecord,
  lessons: lessonRecord,
  lesson_progress: lessonProgressRecord,
  lesson_agent_layers: lessonAgentLayerRecord,
  course_agent_versions: courseAgentVersionRecord,
  course_agent_settings: courseAgentSettingsRecord,
  events: eventRecord,
  event_occurrences: eventOccurrenceRecord,
  event_rsvps: eventRsvpRecord,
  points_ledger: pointsLedgerRecord,
  member_stats: memberStatsRecord,
  membership_plans: membershipPlanRecord,
  subscriptions: subscriptionRecord,
  comped_memberships: compedMembershipRecord,
  invite_links: inviteLinkRecord,
  membership_requests: membershipRequestRecord,
  reviews: reviewRecord,
  review_replies: reviewReplyRecord,
  audit_log: auditLogRecord,
} as const;

export type ArchiveEntity = keyof typeof entitySchemas;

export const archiveEntities = Object.keys(entitySchemas) as ArchiveEntity[];

export type ArchiveRecords = {
  readonly [E in ArchiveEntity]: readonly z.output<(typeof entitySchemas)[E]>[];
};

export type ArchiveRecord<E extends ArchiveEntity> = z.output<(typeof entitySchemas)[E]>;

export type CommunityRecord = ArchiveRecord<"community">;
export type UserRecord = ArchiveRecord<"users">;
export type PostRecord = ArchiveRecord<"posts">;
export type SubscriptionRecord = ArchiveRecord<"subscriptions">;
export type MembershipPlanRecord = ArchiveRecord<"membership_plans">;

export const entitiesAddedIn: Partial<Record<ArchiveEntity, string>> = {
  lesson_agent_layers: "1.1.0",
  course_agent_versions: "1.1.0",
  course_agent_settings: "1.1.0",
  community_gallery: "1.3.0",
  reviews: "1.4.0",
  review_replies: "1.4.0",
};

export function entityPath(entity: ArchiveEntity): string {
  return `data/${entity}.jsonl`;
}
