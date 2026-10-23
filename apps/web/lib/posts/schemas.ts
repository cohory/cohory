import { z } from "zod";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const id = z.uuid();

const textInline = z.object({
  type: z.literal("text"),
  text: z.string().max(20_000),
  marks: z
    .array(z.enum(["bold", "italic", "link"]))
    .max(3)
    .optional(),
  href: z.string().max(2048).optional(),
});

const mentionInline = z.object({
  type: z.literal("mention"),
  userId: z.uuid(),
  label: z.string().trim().min(1).max(80),
});

const inlines = z.array(z.discriminatedUnion("type", [textInline, mentionInline])).max(2_000);
const dimension = z.int().min(1).max(20_000).optional();

const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), content: inlines }),
  z.object({ type: z.literal("bulletList"), items: z.array(inlines).min(1).max(500) }),
  z.object({
    type: z.literal("image"),
    key: z.string().min(1).max(512),
    url: z.string().max(2048),
    alt: z.string().max(300).optional(),
    width: dimension,
    height: dimension,
  }),
  z.object({
    type: z.literal("embed"),
    provider: z.enum(["youtube", "vimeo", "loom"]),
    url: z.string().max(2048),
  }),
]);

export const postDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(block).min(1, "Write something before posting.").max(500),
});

const title = z.string().trim().max(120, "Use 120 characters or fewer for the title.").nullable();

const scheduledAt = z.iso.datetime({
  offset: true,
  message: "Pick a date and time for the post.",
});

export const createPostSchema = z
  .object({
    slug,
    title,
    document: postDocumentSchema,
    categoryId: id.nullable().default(null),
    scheduledAt: scheduledAt.nullable().default(null),
    emailMembers: z.boolean().default(false),
  })
  .refine((input) => !(input.emailMembers && input.scheduledAt), {
    message: "Email members when the post goes live, not on a scheduled post.",
    path: ["emailMembers"],
  });

export const updateScheduledPostSchema = z.object({
  slug,
  postId: id,
  title,
  document: postDocumentSchema,
  categoryId: id.nullable().optional(),
  scheduledAt,
});
export const updatePostSchema = z.object({ slug, postId: id, title, document: postDocumentSchema });
export const postRefSchema = z.object({ slug, postId: id });
export const pinPostSchema = z.object({ slug, postId: id, pinned: z.boolean() });
export const followPostSchema = z.object({ slug, postId: id, following: z.boolean() });
export const toggleLikeSchema = z.object({
  slug,
  subjectType: z.enum(["post", "comment"]),
  subjectId: id,
  liked: z.boolean(),
});
export const createCommentSchema = z.object({
  slug,
  postId: id,
  parentId: id.nullable(),
  document: postDocumentSchema,
});
export const updateCommentSchema = z.object({ slug, commentId: id, document: postDocumentSchema });
export const commentRefSchema = z.object({ slug, commentId: id });
export const feedCategorySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/);
export const feedPageSchema = z.object({
  slug,
  cursor: z.string().min(1).max(512),
  category: feedCategorySchema.nullable().default(null),
  sort: z.enum(["active", "new", "top"]).default("active"),
});
export const feedVisitSchema = z.object({ slug });
export const mentionSearchSchema = z.object({
  slug,
  query: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[\p{L}\p{N}_.-]+$/u),
});

export type CreatePostInput = z.input<typeof createPostSchema>;
export type UpdatePostInput = z.input<typeof updatePostSchema>;
export type UpdateScheduledPostInput = z.input<typeof updateScheduledPostSchema>;
export type PostRefInput = z.input<typeof postRefSchema>;
export type PinPostInput = z.input<typeof pinPostSchema>;
export type FollowPostInput = z.input<typeof followPostSchema>;
export type ToggleLikeInput = z.input<typeof toggleLikeSchema>;
export type CreateCommentInput = z.input<typeof createCommentSchema>;
export type UpdateCommentInput = z.input<typeof updateCommentSchema>;
export type CommentRefInput = z.input<typeof commentRefSchema>;
export type FeedPageInput = z.input<typeof feedPageSchema>;
export type FeedVisitInput = z.input<typeof feedVisitSchema>;
export type MentionSearchInput = z.input<typeof mentionSearchSchema>;
