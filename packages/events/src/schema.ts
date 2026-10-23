import type { PostEvent } from "@cohory/posts";
import { z } from "zod";

const subject = z.enum(["post", "comment"]);
const ids = z.array(z.uuid()).readonly();
const instant = z.iso.datetime({ offset: true });

const likeChange = z.strictObject({
  communityId: z.uuid(),
  reactionId: z.uuid(),
  subjectType: subject,
  subjectId: z.uuid(),
  postId: z.uuid().optional(),
  subjectAuthorId: z.uuid(),
  userId: z.uuid(),
  occurredAt: instant,
});

const removedLikes = z
  .array(z.strictObject({ reactionId: z.uuid(), subjectAuthorId: z.uuid(), userId: z.uuid() }))
  .readonly();

const preview = z.string().min(1).max(300);

export const postCreatedEventSchema = z.strictObject({
  type: z.literal("post.created"),
  payload: z.strictObject({
    communityId: z.uuid(),
    postId: z.uuid(),
    authorId: z.uuid(),
    agentId: z.uuid().nullable().optional(),
    mentionedUserIds: ids,
  }),
});

export const commentCreatedEventSchema = z.strictObject({
  type: z.literal("comment.created"),
  payload: z.strictObject({
    communityId: z.uuid(),
    postId: z.uuid(),
    commentId: z.uuid(),
    parentId: z.uuid().nullable(),
    parentAuthorId: z.uuid().nullable(),
    authorId: z.uuid(),
    agentId: z.uuid().nullable().optional(),
    postAuthorId: z.uuid(),
    mentionedUserIds: ids,
    preview: preview.optional(),
  }),
});

export const postEventSchema = z.discriminatedUnion("type", [
  postCreatedEventSchema,
  commentCreatedEventSchema,
  z.strictObject({
    type: z.literal("mention.created"),
    payload: z.strictObject({
      communityId: z.uuid(),
      subjectType: subject,
      subjectId: z.uuid(),
      postId: z.uuid(),
      authorId: z.uuid(),
      mentionedUserId: z.uuid(),
      preview: preview.optional(),
    }),
  }),
  z.strictObject({ type: z.literal("like.added"), payload: likeChange }),
  z.strictObject({ type: z.literal("like.removed"), payload: likeChange }),
  z.strictObject({
    type: z.literal("post.deleted"),
    payload: z.strictObject({
      communityId: z.uuid(),
      postId: z.uuid(),
      authorId: z.uuid(),
      occurredAt: instant,
      likes: removedLikes,
    }),
  }),
  z.strictObject({
    type: z.literal("report.resolved"),
    payload: z.strictObject({
      communityId: z.uuid(),
      postId: z.uuid(),
      commentId: z.uuid().nullable(),
      reporterIds: z.array(z.uuid()).min(1).max(1000).readonly(),
      resolution: z.enum(["dismissed", "content_removed", "member_banned"]),
      resolvedBy: z.uuid(),
    }),
  }),
  z.strictObject({
    type: z.literal("report.created"),
    payload: z.strictObject({
      communityId: z.uuid(),
      reportId: z.uuid(),
      postId: z.uuid(),
      commentId: z.uuid().nullable(),
      reporterId: z.uuid(),
    }),
  }),
  z.strictObject({
    type: z.literal("post.emailed"),
    payload: z.strictObject({
      communityId: z.uuid(),
      postId: z.uuid(),
      sentBy: z.uuid(),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("comment.deleted"),
    payload: z.strictObject({
      communityId: z.uuid(),
      postId: z.uuid(),
      commentId: z.uuid(),
      authorId: z.uuid(),
      occurredAt: instant,
      likes: removedLikes,
    }),
  }),
]);

export const postEventsJobPayloadSchema = z.strictObject({
  events: z.array(postEventSchema).min(1).max(200),
});

export type PostEventsJobPayload = z.infer<typeof postEventsJobPayloadSchema>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesPostEvent: Same<z.infer<typeof postEventSchema>, PostEvent> = true;
void schemaMatchesPostEvent;
