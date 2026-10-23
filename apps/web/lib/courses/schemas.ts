import { maxDescriptionLength, maxLessonBodyLength, maxTitleLength } from "@cohory/courses";
import { z } from "zod";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const courseSlug = z.string().trim().min(1).max(200);
const id = z.uuid();
const title = z
  .string()
  .trim()
  .min(1, "Add a title.")
  .max(maxTitleLength, `Use ${maxTitleLength} characters or fewer for the title.`);
const description = z
  .string()
  .trim()
  .max(maxDescriptionLength, "Use 2,000 characters or fewer for the description.")
  .nullable();
const storageKey = z.string().trim().min(1).max(512);

const attachment = z.object({
  key: storageKey,
  name: z.string().trim().min(1).max(200),
  size: z.int().min(1),
  contentType: z.string().min(1).max(100),
});

export const createCourseSchema = z.object({
  slug,
  title,
  description,
  coverKey: storageKey.nullable(),
});
export const updateCourseSchema = createCourseSchema.extend({
  courseSlug,
  requiredLevel: z.int().min(1).max(9).nullable().optional(),
});
export const courseRefSchema = z.object({ slug, courseSlug });
export const memberPreviewSchema = z.object({ slug, on: z.boolean() });
export const publishCourseSchema = courseRefSchema.extend({
  publishDraftLessons: z.boolean(),
  announce: z.boolean(),
});
export const createModuleSchema = courseRefSchema.extend({ title });
export const renameModuleSchema = courseRefSchema.extend({ moduleId: id, title });
export const moduleRefSchema = courseRefSchema.extend({ moduleId: id });
export const reorderModulesSchema = courseRefSchema.extend({
  ids: z.array(id).min(1).max(500),
});
export const reorderLessonsSchema = reorderModulesSchema.extend({ moduleId: id });
export const createLessonSchema = moduleRefSchema.extend({ title });
export const lessonRefSchema = courseRefSchema.extend({ lessonId: id });
export const updateLessonSchema = lessonRefSchema.extend({
  title,
  bodyMarkdown: z.string().max(maxLessonBodyLength, "The lesson is too long."),
  videoUrl: z.string().trim().max(2048),
  attachments: z.array(attachment).max(10, "Attach up to 10 files."),
  publish: z.boolean().optional(),
});
export const moveLessonSchema = lessonRefSchema.extend({
  moduleId: id,
  position: z.int().min(0).optional(),
});
export const setLessonPublishedSchema = lessonRefSchema.extend({ published: z.boolean() });
export const setLessonCompleteSchema = lessonRefSchema.extend({ completed: z.boolean() });
export const recordViewSchema = z.object({ slug, lessonId: id });

export type CreateCourseInput = z.input<typeof createCourseSchema>;
export type UpdateCourseInput = z.input<typeof updateCourseSchema>;
export type CourseRefInput = z.input<typeof courseRefSchema>;
export type MemberPreviewInput = z.input<typeof memberPreviewSchema>;
export type PublishCourseInput = z.input<typeof publishCourseSchema>;
export type CreateModuleInput = z.input<typeof createModuleSchema>;
export type RenameModuleInput = z.input<typeof renameModuleSchema>;
export type ModuleRefInput = z.input<typeof moduleRefSchema>;
export type ReorderModulesInput = z.input<typeof reorderModulesSchema>;
export type ReorderLessonsInput = z.input<typeof reorderLessonsSchema>;
export type CreateLessonInput = z.input<typeof createLessonSchema>;
export type LessonRefInput = z.input<typeof lessonRefSchema>;
export type UpdateLessonInput = z.input<typeof updateLessonSchema>;
export type MoveLessonInput = z.input<typeof moveLessonSchema>;
export type SetLessonPublishedInput = z.input<typeof setLessonPublishedSchema>;
export type SetLessonCompleteInput = z.input<typeof setLessonCompleteSchema>;
export type RecordViewInput = z.input<typeof recordViewSchema>;
