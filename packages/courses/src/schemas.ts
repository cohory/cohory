import { embedProviderOf, stripInvisible } from "@cohory/posts";
import { attachmentMaxBytes, attachmentNameMaxLength } from "@cohory/storage";
import { z } from "zod";

export const maxTitleLength = 120;
export const maxDescriptionLength = 2000;
export const maxLessonBodyLength = 100_000;
export const maxLessonAttachments = 10;
export const maxReorderItems = 500;

const title = z.string().trim().min(1).max(maxTitleLength);
const storageKey = z.string().trim().min(1).max(512);

export const attachmentRefSchema = z.strictObject({
  key: storageKey,
  name: z.string().trim().min(1).max(attachmentNameMaxLength),
  size: z.int().min(1).max(attachmentMaxBytes),
  contentType: z.string().min(1).max(100),
});

const videoUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => embedProviderOf(value) !== null, {
    message: "Use a YouTube, Vimeo, Loom, or Wistia link.",
  });

function emptyAsNull<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullish(),
  );
}

export const minRequiredLevel = 1;
export const maxRequiredLevel = 9;

export const createCourseInputSchema = z.strictObject({
  title,
  description: emptyAsNull(z.string().trim().max(maxDescriptionLength).transform(stripInvisible)),
  coverKey: emptyAsNull(storageKey),
  requiredLevel: z.int().min(minRequiredLevel).max(maxRequiredLevel).nullish(),
});

export const updateCourseInputSchema = createCourseInputSchema.partial();

export const moduleInputSchema = z.strictObject({ title });

const lessonFields = {
  title,
  bodyMarkdown: emptyAsNull(z.string().max(maxLessonBodyLength).transform(stripInvisible)),
  videoUrl: emptyAsNull(videoUrl),
  attachments: z.array(attachmentRefSchema).max(maxLessonAttachments).optional(),
};

export const createLessonInputSchema = z.strictObject(lessonFields);

export const updateLessonInputSchema = z
  .strictObject({ ...lessonFields, moduleId: z.uuid() })
  .partial();

export const reorderInputSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(maxReorderItems),
});

export type AttachmentRefInput = z.input<typeof attachmentRefSchema>;
export type CreateCourseInput = z.input<typeof createCourseInputSchema>;
export type UpdateCourseInput = z.input<typeof updateCourseInputSchema>;
export type ModuleInput = z.input<typeof moduleInputSchema>;
export type CreateLessonInput = z.input<typeof createLessonInputSchema>;
export type UpdateLessonInput = z.input<typeof updateLessonInputSchema>;
export type ReorderInput = z.input<typeof reorderInputSchema>;
