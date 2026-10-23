import type { StorageKey } from "@cohory/storage";
import { parseStorageKey } from "@cohory/storage";

import { agentSnapshotSchema, sha256Hex, storedFiles, type AgentSnapshot } from "../agent";
import { CourseNotFoundError, CoursesValidationError } from "../errors";
import type {
  AgentVersionListing,
  AgentVersionRecord,
  CourseRecord,
  LessonRecord,
  ModuleRecord,
} from "../repository";
import type { AgentVersionSummary } from "../agent-views";
import type { Access, Runtime } from "./context";

export function toVersionSummary(row: AgentVersionListing): AgentVersionSummary {
  return {
    id: row.id,
    courseId: row.courseId,
    version: row.version,
    changelog: row.changelog,
    checksum: row.checksum,
    publishedAt: row.createdAt,
  };
}

export function snapshotOf(row: AgentVersionRecord): AgentSnapshot {
  return agentSnapshotSchema.parse(row.snapshot);
}

export function lessonsInCourseOrder(
  modules: readonly ModuleRecord[],
  lessons: readonly LessonRecord[],
): { lesson: LessonRecord; module: ModuleRecord }[] {
  const order = new Map(
    [...modules]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((module, index) => [module.id, { module, index }]),
  );
  return lessons
    .flatMap((lesson) => {
      const entry = order.get(lesson.moduleId);
      return entry ? [{ lesson, module: entry.module, index: entry.index }] : [];
    })
    .sort(
      (a, b) =>
        a.index - b.index ||
        a.lesson.position - b.lesson.position ||
        a.lesson.id.localeCompare(b.lesson.id),
    )
    .map(({ lesson, module }) => ({ lesson, module }));
}

export async function requireVersion(
  access: Access,
  course: CourseRecord,
  version: string | null | undefined,
): Promise<AgentVersionRecord> {
  const row = await access.store.findAgentVersion(course.id, version ?? null);
  if (!row) {
    throw new CourseNotFoundError("agent_version");
  }
  return row;
}

export async function readFile(runtime: Runtime, key: string): Promise<Uint8Array | null> {
  let storageKey: StorageKey;
  try {
    storageKey = parseStorageKey(key);
  } catch {
    return null;
  }
  const object = await runtime.storage.get(storageKey);
  return object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
}

export async function readSnapshotFiles(
  runtime: Runtime,
  snapshot: AgentSnapshot,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const problems: { path: string; message: string }[] = [];
  for (const { path, file } of storedFiles(snapshot)) {
    if (files.has(file.key)) continue;
    const bytes = await readFile(runtime, file.key);
    if (!bytes || bytes.byteLength !== file.size || sha256Hex(bytes) !== file.sha256) {
      problems.push({
        path,
        message: `The file ${file.name} is missing or changed. Upload it again.`,
      });
      continue;
    }
    files.set(file.key, bytes);
  }
  if (problems.length > 0) {
    throw new CoursesValidationError(problems);
  }
  return files;
}
