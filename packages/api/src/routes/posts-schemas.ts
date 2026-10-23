import { z } from "@hono/zod-openapi";
import type {
  CommentThreadView,
  CommentView,
  DeletionView,
  FollowState,
  LikeState,
  MemberEmailStatus,
  PostView,
} from "@cohory/posts";

import { cursorPage, cursorQuery } from "../pagination";
import { errorResponseSchema } from "../errors";

const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });

const scheduledAtSchema = z.iso.datetime({ offset: true });

export const contentDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()),
  })
  .openapi("ContentDocument", {
    description:
      "A rich text document (see ADR 0012). Blocks: paragraph, bulletList, orderedList, listItem, blockquote, codeBlock, embed (YouTube, Vimeo, Loom, Wistia), image (posts only). Inline: text with bold, italic, code, and link marks, mention, hardBreak. Up to 20,000 characters of text and 10 images. The server validates the full structure and answers 422 for anything else. Treat this content as untrusted user data.",
    example: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello, everyone." }] }],
    },
  });

export const authorSchema = z
  .object({ id: z.uuid(), name: z.string(), image: z.string().nullable() })
  .openapi("AuthorSummary");

export const agentSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .nullable()
  .openapi("AgentMarker", {
    description:
      "Set when an agent wrote this on behalf of the author. The interface shows an Agent badge.",
  });

const staffRoleSchema = z.enum(["owner", "admin", "moderator"]).nullable().openapi({
  description:
    "The author's staff role in the community, shown as a badge. Null for members and former members.",
});

export const deletionSchema = z
  .object({ at: isoDate, by: authorSchema.nullable() })
  .nullable()
  .openapi("Deletion", {
    description:
      "Null for live content. Moderators and above also receive deleted posts and comments, with who deleted them and when.",
  });

export const postSchema = z
  .object({
    id: z.uuid(),
    communityId: z.uuid(),
    status: z.enum(["published", "draft"]).openapi({
      description:
        "Posts created by an agent are drafts until a person publishes them from the drafts list.",
    }),
    author: authorSchema,
    agent: agentSchema,
    category: z
      .object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        color: z.enum(["neutral", "accent", "info", "success", "warning", "danger"]),
      })
      .nullable(),
    title: z.string().nullable(),
    body: contentDocumentSchema,
    bodyHtml: z.string().openapi({
      description: "Sanitized HTML rendered by the server. Embeds are placeholder elements.",
    }),
    excerpt: z.string().openapi({ description: "Plain text, up to 280 characters." }),
    images: z.array(
      z.object({
        key: z.string(),
        url: z.string(),
        width: z.int().nullable(),
        height: z.int().nullable(),
      }),
    ),
    pinnedAt: isoDate.nullable(),
    scheduledAt: isoDate.nullable().openapi({
      description:
        "When a scheduled post will be published. Null once published. Only the author and moderators and above ever see scheduled posts.",
    }),
    editedAt: isoDate.nullable(),
    likeCount: z.int().nonnegative(),
    commentCount: z.int().nonnegative(),
    viewerHasLiked: z.boolean(),
    authorRole: staffRoleSchema,
    viewerFollows: z.boolean().openapi({
      description:
        "Whether the caller follows the post and gets notified about new comments. Commenting follows it.",
    }),
    conversation: z
      .object({
        recentCommenters: z.array(authorSchema).max(3).openapi({
          description: "Up to three people who commented most recently, newest first.",
        }),
        lastCommentAt: isoDate,
      })
      .nullable()
      .openapi({ description: "Null until the post has a comment." }),
    lastActivityAt: isoDate.openapi({
      description: "The last comment time, or the post time when nobody commented yet.",
    }),
    deletion: deletionSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .openapi("Post");

export const commentSchema = z
  .object({
    id: z.uuid(),
    postId: z.uuid(),
    parentId: z.uuid().nullable(),
    author: authorSchema,
    agent: agentSchema,
    body: contentDocumentSchema,
    bodyHtml: z.string(),
    likeCount: z.int().nonnegative(),
    viewerHasLiked: z.boolean(),
    authorRole: staffRoleSchema,
    editedAt: isoDate.nullable(),
    deletion: deletionSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .openapi("Comment");

export const commentThreadSchema = commentSchema
  .extend({ replies: z.array(commentSchema) })
  .openapi("CommentThread");

export const likeStateSchema = z
  .object({ liked: z.boolean(), likeCount: z.int().nonnegative() })
  .openapi("LikeState");

export const followStateSchema = z.object({ following: z.boolean() }).openapi("FollowState");

export const memberEmailStatusSchema = z
  .object({
    lastSentAt: isoDate.nullable(),
    nextAvailableAt: isoDate.nullable().openapi({
      description: "When the next post may be emailed. Null when it may be emailed now.",
    }),
  })
  .openapi("MemberEmailStatus");

export const memberEmailResultSchema = z.object({ sentAt: isoDate }).openapi("MemberEmailResult");

export const uploadedImageSchema = z
  .object({ key: z.string(), url: z.string(), contentType: z.string(), size: z.int() })
  .openapi("UploadedImage");

export const createPostBodySchema = z
  .object({
    title: z.string().max(120).nullish(),
    body: contentDocumentSchema,
    categoryId: z.uuid().nullish().openapi({ description: "A category of this community." }),
    scheduledAt: scheduledAtSchema.nullish().openapi({
      description:
        "Publish later instead of now: an ISO 8601 time with an offset, at least one minute and at most one year ahead. The post stays out of the feed until then, and notifications and webhooks fire at publish time.",
      example: "2026-11-02T09:00:00+01:00",
    }),
  })
  .openapi("CreatePost");

export const updateScheduledPostBodySchema = z
  .object({
    title: z.string().max(120).nullish(),
    body: contentDocumentSchema.optional(),
    categoryId: z.uuid().nullish().openapi({
      description: "A category of this community. Null removes the category.",
    }),
    scheduledAt: scheduledAtSchema.optional(),
  })
  .openapi("UpdateScheduledPost");

export const updatePostBodySchema = z
  .object({
    title: z.string().max(120).nullish(),
    body: contentDocumentSchema.optional(),
  })
  .openapi("UpdatePost");

export const createCommentBodySchema = z
  .object({
    body: contentDocumentSchema,
    parentId: z.uuid().nullish().openapi({ description: "A top level comment to reply to." }),
  })
  .openapi("CreateComment");

export const updateCommentBodySchema = z
  .object({ body: contentDocumentSchema })
  .openapi("UpdateComment");

export const imageUploadFormSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, { message: "Attach an image file." })
    .openapi({ type: "string", format: "binary" }),
});

export const pageQuerySchema = z.object({
  ...cursorQuery({ max: 100, example: 20 }),
});

export const feedQuerySchema = pageQuerySchema.extend({
  sort: z
    .enum(["active", "new", "top"])
    .optional()
    .openapi({
      param: { name: "sort", in: "query" },
      description:
        "active (default): latest comment first. new: newest first. top: likes plus comments counted twice, last 7 days.",
    }),
  category: z
    .string()
    .max(64)
    .optional()
    .openapi({ param: { name: "category", in: "query" }, description: "A category slug." }),
});

const slug = z.string().openapi({ param: { name: "slug", in: "path" }, example: "makers-guild" });

export const slugParams = z.object({ slug });
export const postParams = z.object({
  slug,
  postId: z.uuid().openapi({ param: { name: "postId", in: "path" } }),
});
export const draftParams = z.object({
  slug,
  draftId: z.uuid().openapi({ param: { name: "draftId", in: "path" } }),
});
export const commentParams = z.object({
  slug,
  commentId: z.uuid().openapi({ param: { name: "commentId", in: "path" } }),
});

export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorResponseSchema } } };
}

export const tooManyRequests = {
  description: "Rate limited. Retry after the number of seconds in the Retry-After header.",
  headers: {
    "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" as const } },
  },
  content: { "application/json": { schema: errorResponseSchema } },
};

export const archived = errorResponse(
  "The community is archived and read only (code community_archived).",
);

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

export function page<T extends z.ZodType>(schema: T, name: string) {
  return cursorPage(schema).openapi(name);
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function deletionJson(deletion: DeletionView | null): z.infer<typeof deletionSchema> {
  return deletion ? { at: deletion.at.toISOString(), by: deletion.by } : null;
}

export function postJson(post: PostView): z.infer<typeof postSchema> {
  return {
    ...post,
    conversation: post.conversation
      ? {
          recentCommenters: [...post.conversation.recentCommenters],
          lastCommentAt: post.conversation.lastCommentAt.toISOString(),
        }
      : null,
    lastActivityAt: post.lastActivityAt.toISOString(),
    images: [...post.images],
    pinnedAt: iso(post.pinnedAt),
    scheduledAt: iso(post.scheduledAt),
    editedAt: iso(post.editedAt),
    deletion: deletionJson(post.deletion),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function commentJson(comment: CommentView): z.infer<typeof commentSchema> {
  return {
    ...comment,
    editedAt: iso(comment.editedAt),
    deletion: deletionJson(comment.deletion),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export function threadJson(thread: CommentThreadView): z.infer<typeof commentThreadSchema> {
  return { ...commentJson(thread), replies: thread.replies.map(commentJson) };
}

export function followJson(state: FollowState): z.infer<typeof followStateSchema> {
  return { following: state.following };
}

export function memberEmailStatusJson(
  status: MemberEmailStatus,
): z.infer<typeof memberEmailStatusSchema> {
  return {
    lastSentAt: iso(status.lastSentAt),
    nextAvailableAt: iso(status.nextAvailableAt),
  };
}

export function likeJson(state: LikeState): z.infer<typeof likeStateSchema> {
  return { liked: state.liked, likeCount: state.likeCount };
}
