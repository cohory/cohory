import { assertCan, type Actor } from "@cohory/authz";

import {
  agentContentNotice,
  sha256Hex,
  storedFiles,
  toAgentMaterial,
  type AgentMaterial,
} from "../agent";
import type { AgentFileDownload, AgentMaterialOptions, AgentTaskView } from "../agent-views";
import { CourseNotFoundError } from "../errors";
import type { CourseRecord } from "../repository";
import { isUuid, withAccess, type Access, type Runtime } from "./context";
import { readFile, requireVersion, snapshotOf } from "./agent-shared";
import { assertUnlocked } from "./outline";

export interface AgentReadingOperations {
  getAgentMaterial(
    actor: Actor,
    communityId: string,
    courseId: string,
    options?: AgentMaterialOptions,
  ): Promise<AgentMaterial>;
  getAgentTask(
    actor: Actor,
    communityId: string,
    courseId: string,
    lessonId: string,
    taskId: string,
    version?: string | null,
  ): Promise<AgentTaskView>;
  getAgentMaterialFile(
    actor: Actor,
    communityId: string,
    courseId: string,
    path: string,
    version?: string | null,
  ): Promise<AgentFileDownload>;
}

export async function readableCourse(access: Access, courseId: string): Promise<CourseRecord> {
  const course = isUuid(courseId)
    ? await access.store.findCourseById(courseId, access.visibility)
    : null;
  if (!course) {
    throw new CourseNotFoundError("course");
  }
  await access.assertCourseReadable(course.id);
  await assertUnlocked(access, course);
  return course;
}

export function createAgentReadingOperations(runtime: Runtime): AgentReadingOperations {
  return {
    getAgentMaterial(actor, communityId, courseId, options = {}) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "course", access.context);
        const course = await readableCourse(access, courseId);
        const row = await requireVersion(access, course, options.version);
        return toAgentMaterial(snapshotOf(row), row.checksum);
      });
    },

    getAgentTask(actor, communityId, courseId, lessonId, taskId, version) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "lesson", access.context);
        const course = await readableCourse(access, courseId);
        const row = await requireVersion(access, course, version);
        const snapshot = snapshotOf(row);
        const lesson = snapshot.lessons.find((candidate) => candidate.id === lessonId);
        const task = lesson?.layer.tasks.find((candidate) => candidate.id === taskId);
        if (!lesson || !task) {
          throw new CourseNotFoundError("agent_task");
        }
        return {
          notice: agentContentNotice,
          course: { id: course.id, slug: course.slug, title: snapshot.manifest.course.title },
          version: row.version,
          checksum: row.checksum,
          lesson: {
            id: lesson.id,
            slug: lesson.slug,
            title: lesson.title,
            position: lesson.position,
            objective: lesson.layer.objective,
          },
          task,
          evaluations: lesson.layer.evaluations.filter(
            (evaluation) => evaluation.taskId === task.id,
          ),
        };
      });
    },

    async getAgentMaterialFile(actor, communityId, courseId, path, version) {
      const stored = await withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "lesson", access.context);
        const course = await readableCourse(access, courseId);
        const snapshot = snapshotOf(await requireVersion(access, course, version));
        return storedFiles(snapshot).find((candidate) => candidate.path === path) ?? null;
      });
      if (!stored) {
        throw new CourseNotFoundError("agent_file");
      }
      const bytes = await readFile(runtime, stored.file.key);
      if (!bytes || sha256Hex(bytes) !== stored.file.sha256) {
        throw new CourseNotFoundError("agent_file");
      }
      return {
        name: stored.file.name,
        mediaType: stored.file.mediaType,
        sha256: stored.file.sha256,
        bytes,
      };
    },
  };
}
