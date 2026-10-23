import { categoryColor } from "@cohory/db/schema";
import { z } from "zod";

import { feedSorts } from "./repository";

export const maxTitleLength = 120;
export const feedPageSize = 20;
export const commentsPageSize = 50;
export const maxPageSize = 100;
export const maxPinnedPosts = 3;
export const postImageMaxBytes = 10 * 1024 * 1024;

const titleSchema = z
  .string()
  .trim()
  .max(maxTitleLength)
  .nullish()
  .transform((title) => (title ? title : null));

export const maxCategories = 10;
export const categoryNameMaxLength = 40;

export const minScheduleLeadMs = 60 * 1000;
export const maxScheduleAheadMs = 365 * 24 * 60 * 60 * 1000;
export const scheduledPostsLimit = 100;
export const recentCommentersLimit = 3;
export const memberEmailIntervalMs = 24 * 60 * 60 * 1000;

const scheduledAtSchema = z.union([
  z.date(),
  z.iso
    .datetime({ offset: true, message: "Enter a date and time with a time zone." })
    .transform((value) => new Date(value)),
]);

export const createPostInputSchema = z.object({
  title: titleSchema,
  body: z.unknown(),
  categoryId: z.uuid().nullish(),
  scheduledAt: scheduledAtSchema.nullish(),
});

export const updateScheduledPostInputSchema = z
  .object({
    title: titleSchema.optional(),
    body: z.unknown().optional(),
    categoryId: z.uuid().nullable().optional(),
    scheduledAt: scheduledAtSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Change the title, the body, the category, or the time.",
  });

export const updatePostInputSchema = z
  .object({
    title: titleSchema.optional(),
    body: z.unknown().optional(),
  })
  .refine((input) => input.title !== undefined || input.body !== undefined, {
    message: "Change the title or the body.",
  });

export const createCommentInputSchema = z.object({
  body: z.unknown(),
  parentId: z.uuid().nullish(),
});

export const updateCommentInputSchema = z.object({
  body: z.unknown(),
});

export const pageInputSchema = z.object({
  cursor: z.string().max(512).nullish(),
  limit: z.int().min(1).max(maxPageSize).optional(),
});

export const feedInputSchema = pageInputSchema.extend({
  category: z.string().trim().min(1).max(64).nullish(),
  sort: z.enum(feedSorts).default("active"),
});

export const topWindowDays = 7;

const categoryNameSchema = z.string().trim().min(1).max(categoryNameMaxLength);

export const createCategoryInputSchema = z.strictObject({
  name: categoryNameSchema,
  color: z.enum(categoryColor.enumValues).default("neutral"),
  staffOnly: z.boolean().default(false),
});

export const updateCategoryInputSchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    color: z.enum(categoryColor.enumValues).optional(),
    staffOnly: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Change the name, color, or who can post.",
  });

export const reorderCategoriesInputSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(maxCategories),
});

export type CreatePostInput = z.input<typeof createPostInputSchema>;
export type UpdatePostInput = z.input<typeof updatePostInputSchema>;
export type UpdateScheduledPostInput = z.input<typeof updateScheduledPostInputSchema>;
export type CreateCommentInput = z.input<typeof createCommentInputSchema>;
export type UpdateCommentInput = z.input<typeof updateCommentInputSchema>;
export type PageInput = z.input<typeof pageInputSchema>;
export type FeedInput = z.input<typeof feedInputSchema>;
export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.input<typeof updateCategoryInputSchema>;
export type ReorderCategoriesInput = z.input<typeof reorderCategoriesInputSchema>;
