import { assertCan, type Actor } from "@cohory/authz";
import {
  contentTypeForKey,
  courseAgentFileKey,
  isCourseAgentFileKey,
  validateAttachment,
  type AttachmentUpload,
} from "@cohory/storage";
import { z } from "zod";

import {
  agentLessonLayerSchema,
  agentLicenseSchema,
  agentLimits,
  bumpSemver,
  buildSnapshot,
  draftAgentLayer,
  formatSemver,
  manifestLicense,
  nextVersions,
  sameLicenseId,
  sha256Hex,
  versionBumps,
  type AgentFile,
  type AgentLessonLayer,
  type AgentLessonLayerInput,
} from "../agent";
import type {
  AgentAuthoring,
  AgentSkillDownload,
  AgentVersionSummary,
  LessonAgentLayerView,
} from "../agent-views";
import { buildSkillExport } from "../agent/skill";
import { CourseNotFoundError, CoursesValidationError } from "../errors";
import type { CourseRecord, LessonRecord } from "../repository";
import {
  isUuid,
  parse,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Runtime,
} from "./context";
import {
  lessonsInCourseOrder,
  readSnapshotFiles,
  requireVersion,
  snapshotOf,
  toVersionSummary,
} from "./agent-shared";
import { requireCourse } from "./outline";

export const publishAgentVersionInputSchema = z.strictObject({
  bump: z.enum(versionBumps),
  changelog: z.string().trim().max(agentLimits.changelog).default(""),
  license: agentLicenseSchema.optional(),
});

async function courseLicense(runtime: Runtime, communityId: string, courseId: string) {
  const terms = (await runtime.agentAccess.courseAgentTerms(communityId, [courseId])).get(courseId);
  if (!terms) {
    throw new CourseNotFoundError("course");
  }
  return manifestLicense(terms.license);
}

export type PublishAgentVersionInput = z.input<typeof publishAgentVersionInputSchema>;

export interface AgentAuthoringOperations {
  getAgentAuthoring(actor: Actor, communityId: string, courseSlug: string): Promise<AgentAuthoring>;
  getLessonAgentLayer(
    actor: Actor,
    communityId: string,
    lessonId: string,
  ): Promise<LessonAgentLayerView>;
  saveLessonAgentLayer(
    actor: Actor,
    communityId: string,
    lessonId: string,
    input: AgentLessonLayerInput,
  ): Promise<LessonAgentLayerView>;
  deleteLessonAgentLayer(actor: Actor, communityId: string, lessonId: string): Promise<void>;
  draftLessonAgentLayer(
    actor: Actor,
    communityId: string,
    lessonId: string,
  ): Promise<AgentLessonLayer>;
  uploadAgentFile(
    actor: Actor,
    communityId: string,
    courseId: string,
    upload: AttachmentUpload,
  ): Promise<AgentFile>;
  publishAgentVersion(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    input: PublishAgentVersionInput,
  ): Promise<AgentVersionSummary>;
  listAgentVersions(
    actor: Actor,
    communityId: string,
    courseSlug: string,
  ): Promise<AgentVersionSummary[]>;
  exportAgentVersion(
    actor: Actor,
    communityId: string,
    courseSlug: string,
    version: string,
  ): Promise<AgentSkillDownload>;
}

async function requireManagedLesson(
  access: Access,
  lessonId: string,
): Promise<{ lesson: LessonRecord; course: CourseRecord }> {
  const lesson = isUuid(lessonId) ? await access.store.findVisibleLesson(lessonId, "all") : null;
  const course = lesson ? await access.store.findCourseById(lesson.courseId, "all") : null;
  if (!lesson || !course) {
    throw new CourseNotFoundError("lesson");
  }
  return { lesson, course };
}

function layerView(
  lesson: LessonRecord,
  layer: AgentLessonLayer | null,
  updatedAt: Date | null,
): LessonAgentLayerView {
  return {
    lesson: {
      id: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      status: lesson.status,
      courseId: lesson.courseId,
    },
    layer,
    updatedAt,
  };
}

function storedLayer(raw: unknown): AgentLessonLayer | null {
  const parsed = agentLessonLayerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function checkFiles(
  communityId: string,
  courseId: string,
  layer: AgentLessonLayer,
): AgentLessonLayer {
  const fix = (file: AgentFile, path: string): AgentFile => {
    const mediaType = contentTypeForKey(file.key);
    if (!isCourseAgentFileKey(file.key, communityId, courseId) || !mediaType) {
      throw new CoursesValidationError([
        { path, message: "Upload this file again in this course's agent material." },
      ]);
    }
    return { ...file, mediaType };
  };
  return {
    ...layer,
    references: layer.references.map((reference, index) => ({
      ...reference,
      file: fix(reference.file, `references.${index}.file`),
    })),
    templates: layer.templates.map((template, index) =>
      template.kind === "file"
        ? { ...template, file: fix(template.file, `templates.${index}.file`) }
        : template,
    ),
  };
}

export function agentFileName(name: string, extension: string): string {
  const stem = name
    .slice(0, name.length - extension.length - 1)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .slice(0, agentLimits.fileName - extension.length - 1)
    .replace(/[^A-Za-z0-9]+$/g, "");
  return `${stem || "file"}.${extension}`;
}

export function createAgentAuthoringOperations(runtime: Runtime): AgentAuthoringOperations {
  function managed<T>(
    actor: Actor,
    communityId: string,
    write: boolean,
    fn: (access: Access) => Promise<T>,
  ): Promise<T> {
    const run = write ? withWriteAccess : withAccess;
    return run(runtime, actor, communityId, async (access) => {
      assertCan(actor, write ? "update" : "read_drafts", "course", access.context);
      return fn(access);
    });
  }

  return {
    getAgentAuthoring(actor, communityId, courseSlug) {
      return managed(actor, communityId, false, async (access) => {
        const course = await requireCourse(access, courseSlug);
        const modules = await access.store.listModules(course.id);
        const lessons = await access.store.listLessons(course.id, "all");
        const layers = await access.store.listLessonAgentLayers(course.id);
        const versions = await access.store.listAgentVersions(course.id);
        const byLesson = new Map(layers.map((row) => [row.lessonId, row]));
        const latest = await access.store.findAgentVersion(course.id, null);
        const latestSnapshot = latest ? snapshotOf(latest) : null;
        return {
          course: { id: course.id, slug: course.slug, title: course.title },
          lessons: lessonsInCourseOrder(modules, lessons).map(({ lesson, module }) => {
            const layer = byLesson.get(lesson.id);
            return {
              id: lesson.id,
              slug: lesson.slug,
              title: lesson.title,
              status: lesson.status,
              moduleTitle: module.title,
              hasLayer: layer !== undefined,
              layerUpdatedAt: layer?.updatedAt ?? null,
              includedOnPublish: layer !== undefined && lesson.status === "published",
            };
          }),
          versions: versions.map(toVersionSummary),
          nextVersions: nextVersions(latest),
          license: await courseLicense(runtime, access.community.id, course.id),
          latestLicense: latestSnapshot?.manifest.license ?? null,
        };
      });
    },

    getLessonAgentLayer(actor, communityId, lessonId) {
      return managed(actor, communityId, false, async (access) => {
        const { lesson } = await requireManagedLesson(access, lessonId);
        const row = await access.store.findLessonAgentLayer(lesson.id);
        return layerView(lesson, row ? storedLayer(row.layer) : null, row?.updatedAt ?? null);
      });
    },

    saveLessonAgentLayer(actor, communityId, lessonId, input) {
      return managed(actor, communityId, true, async (access) => {
        const parsed = parse(agentLessonLayerSchema, input);
        const { lesson, course } = await requireManagedLesson(access, lessonId);
        const layer = checkFiles(access.community.id, course.id, parsed);
        const row = await access.store.saveLessonAgentLayer({
          lessonId: lesson.id,
          courseId: course.id,
          layer: { ...layer },
          updatedBy: requireUserId(actor),
        });
        return layerView(lesson, layer, row.updatedAt);
      });
    },

    deleteLessonAgentLayer(actor, communityId, lessonId) {
      return managed(actor, communityId, true, async (access) => {
        assertCan(actor, "delete", "lesson", access.context);
        const { lesson } = await requireManagedLesson(access, lessonId);
        await access.store.deleteLessonAgentLayer(lesson.id);
      });
    },

    draftLessonAgentLayer(actor, communityId, lessonId) {
      return managed(actor, communityId, false, async (access) => {
        const { lesson } = await requireManagedLesson(access, lessonId);
        return draftAgentLayer({ title: lesson.title, bodyMarkdown: lesson.bodyMarkdown });
      });
    },

    async uploadAgentFile(actor, communityId, courseId, upload) {
      const scope = await managed(actor, communityId, true, async (access) => {
        const course = isUuid(courseId) ? await access.store.findCourseById(courseId, "all") : null;
        if (!course) {
          throw new CourseNotFoundError("course");
        }
        return { communityId: access.community.id, courseId: course.id };
      });
      const file = validateAttachment(upload);
      await runtime.uploadGuard(scope.communityId, file.size);
      const key = courseAgentFileKey(
        scope.communityId,
        scope.courseId,
        runtime.newId(),
        file.extension,
      );
      await runtime.storage.put({ key, body: upload.bytes, contentType: file.contentType });
      return {
        name: agentFileName(file.name, file.extension),
        key,
        mediaType: file.contentType,
        size: file.size,
        sha256: sha256Hex(upload.bytes),
      };
    },

    publishAgentVersion(actor, communityId, courseSlug, input) {
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "publish_agent_version", "course", access.context);
        const {
          bump,
          changelog,
          license: requested,
        } = parse(publishAgentVersionInputSchema, input);
        const course = await requireCourse(access, courseSlug);
        const license = await courseLicense(runtime, access.community.id, course.id);
        if (requested && !sameLicenseId(requested, license)) {
          throw new CoursesValidationError([
            {
              path: "license",
              message:
                "The license terms changed in Agent access. Reload to publish with the current terms.",
            },
          ]);
        }
        const modules = await access.store.listModules(course.id);
        const lessons = await access.store.listLessons(course.id, "all");
        const layers = await access.store.listLessonAgentLayers(course.id);
        const byLesson = new Map(layers.map((row) => [row.lessonId, storedLayer(row.layer)]));
        const included = lessonsInCourseOrder(modules, lessons).flatMap(({ lesson }) => {
          const layer = byLesson.get(lesson.id);
          return lesson.status === "published" && layer
            ? [{ id: lesson.id, slug: lesson.slug, title: lesson.title, layer }]
            : [];
        });
        if (included.length === 0) {
          throw new CoursesValidationError([
            { path: "lessons", message: "Add agent material to at least one published lesson." },
          ]);
        }
        const latest = await access.store.findAgentVersion(course.id, null);
        const next = bumpSemver(latest, bump);
        const version = formatSemver(next);
        const built = buildSnapshot({
          course,
          lessons: included,
          version,
          changelog,
          publishedAt: runtime.now(),
          license,
          sourceUrl: `${runtime.appUrl}/c/${access.community.slug}/classroom/${course.slug}`,
        });
        if (
          latest &&
          snapshotOf(latest).manifest.contentSha256 === built.snapshot.manifest.contentSha256
        ) {
          throw new CoursesValidationError([
            { path: "bump", message: `Nothing changed since version ${latest.version}.` },
          ]);
        }
        await readSnapshotFiles(runtime, built.snapshot);
        const row = await access.store.insertAgentVersion({
          courseId: course.id,
          version,
          ...next,
          changelog,
          snapshot: { ...built.snapshot },
          checksum: built.checksum,
          publishedBy: access.viewerId,
        });
        if (!row) {
          throw new CoursesValidationError([
            {
              path: "bump",
              message: `Version ${version} was just published. Reload and try again.`,
            },
          ]);
        }
        return toVersionSummary(row);
      });
    },

    listAgentVersions(actor, communityId, courseSlug) {
      return managed(actor, communityId, false, async (access) => {
        const course = await requireCourse(access, courseSlug);
        return (await access.store.listAgentVersions(course.id)).map(toVersionSummary);
      });
    },

    async exportAgentVersion(actor, communityId, courseSlug, version) {
      const row = await managed(actor, communityId, false, async (access) =>
        requireVersion(access, await requireCourse(access, courseSlug), version),
      );
      const snapshot = snapshotOf(row);
      const files = await readSnapshotFiles(runtime, snapshot);
      const skill = buildSkillExport(snapshot, row.checksum, files);
      return {
        fileName: skill.fileName,
        version: row.version,
        checksum: row.checksum,
        bytes: skill.zip,
      };
    },
  };
}
