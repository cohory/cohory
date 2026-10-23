export {
  CourseNotFoundError,
  CoursesError,
  CoursesValidationError,
  ReorderMismatchError,
  type CoursesErrorCode,
  type CoursesValidationIssue,
} from "./errors";
export { lessonCompletionsBetween, type LessonCompletion } from "./completions";
export { renderLessonHtml, uploadsPathPrefix, type RenderLessonOptions } from "./markdown";
export { appendPosition, planReorder, positionGap, type Positioned } from "./positions";
export { createPostgresCoursesRepository } from "./postgres-repository";
export { progressPercent } from "./progress";
export type { CoursesRepository, CoursesStore } from "./repository";
export {
  maxDescriptionLength,
  maxLessonAttachments,
  maxLessonBodyLength,
  maxRequiredLevel,
  maxReorderItems,
  maxTitleLength,
  minRequiredLevel,
  type AttachmentRefInput,
  type CreateCourseInput,
  type CreateLessonInput,
  type ModuleInput,
  type ReorderInput,
  type UpdateCourseInput,
  type UpdateLessonInput,
} from "./schemas";
export { createCoursesService, createDefaultCoursesService, type CoursesService } from "./service";
export type {
  AgentCourseAccessCheck,
  AttachmentStorage,
  CoursesServiceDeps,
} from "./service/context";
export type { LessonSearchHit } from "./service/search";
export { maxSlugLength, nextFreeSlug, reservedSlugs, slugify } from "./slug";
export type {
  AttachmentRef,
  ContinueLearning,
  CourseDetail,
  CoursePreview,
  CourseProgress,
  CourseSummary,
  DeleteCourseResult,
  LessonDetail,
  LessonLink,
  LessonSummary,
  LessonView,
  ModuleView,
} from "./views";
export * from "./agent";
export {
  downloadLinkTtlMs,
  signDownload,
  verifyDownload,
  type DownloadGrant,
} from "./download-links";
export { inlineTextMaxBytes } from "./service/agent-delivery";
export type {
  AgentAuthoring,
  AgentAuthoringLesson,
  AgentCourseAccessKind,
  AgentCourseListing,
  AgentDownloadLink,
  AgentFileBody,
  AgentFileContent,
  AgentSkillLink,
  AgentFileDownload,
  AgentFileRef,
  AgentMaterialOptions,
  AgentSkillDownload,
  AgentTaskView,
  AgentVersionSummary,
  LessonAgentLayerView,
} from "./agent-views";
export {
  agentFileName,
  publishAgentVersionInputSchema,
  type PublishAgentVersionInput,
} from "./service/agent-authoring";
export {
  agentFilesGraceMs,
  collectAgentFileGarbage,
  collectDefaultAgentFileGarbage,
  type AgentFileGarbageResult,
} from "./agent-gc";
export { countPublishedCourses } from "./counts";
