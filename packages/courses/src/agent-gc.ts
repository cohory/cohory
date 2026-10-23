import {
  communityIdSchema,
  getDb,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type Database,
} from "@cohory/db";
import { communities, courseAgentVersions, courses, lessonAgentLayers } from "@cohory/db/schema";
import {
  courseAgentPrefix,
  getStorage,
  isCourseAgentFileKey,
  type StorageDriver,
} from "@cohory/storage";
import { eq, isNull } from "drizzle-orm";

export const agentFilesGraceMs = 7 * 24 * 60 * 60 * 1000;

export interface AgentFileGarbageDeps {
  readonly db: Database;
  readonly storage: Pick<StorageDriver, "list" | "delete">;
  readonly now?: () => Date;
  readonly graceMs?: number;
  readonly communityIds?: readonly string[];
}

export interface AgentFileGarbageResult {
  readonly courses: number;
  readonly deleted: number;
  readonly bytes: number;
}

const agentKeyPattern =
  /communities\/[0-9a-f-]{36}\/courses\/[0-9a-f-]{36}\/agent\/[0-9a-f-]{36}\.[a-z]+/g;

function referencedKeys(documents: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const document of documents) {
    for (const match of JSON.stringify(document).matchAll(agentKeyPattern)) {
      keys.add(match[0]);
    }
  }
  return keys;
}

async function coursesWithReferences(
  db: Database,
  communityId: string,
): Promise<Map<string, Set<string>>> {
  return runInCommunity(withCommunity(db, communityIdSchema.parse(communityId)), async (q) => {
    await setRlsFlag(q.tx, "course_manager");
    const courseRows = await q.tx.select({ id: courses.id }).from(courses).where(q.where(courses));
    const result = new Map<string, Set<string>>();
    for (const course of courseRows) {
      const layers = await q.tx
        .select({ layer: lessonAgentLayers.layer })
        .from(lessonAgentLayers)
        .where(q.where(lessonAgentLayers, eq(lessonAgentLayers.courseId, course.id)));
      const versions = await q.tx
        .select({ snapshot: courseAgentVersions.snapshot })
        .from(courseAgentVersions)
        .where(q.where(courseAgentVersions, eq(courseAgentVersions.courseId, course.id)));
      result.set(
        course.id,
        referencedKeys([...layers.map((row) => row.layer), ...versions.map((row) => row.snapshot)]),
      );
    }
    return result;
  });
}

export async function collectAgentFileGarbage(
  deps: AgentFileGarbageDeps,
): Promise<AgentFileGarbageResult> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const graceMs = deps.graceMs ?? agentFilesGraceMs;
  const communityIds =
    deps.communityIds ??
    (
      await deps.db
        .select({ id: communities.id })
        .from(communities)
        .where(isNull(communities.deletedAt))
    ).map((row) => row.id);
  let courseCount = 0;
  let deleted = 0;
  let bytes = 0;
  for (const communityId of communityIds) {
    const referenced = await coursesWithReferences(deps.db, communityId);
    for (const [courseId, keys] of referenced) {
      const stored = await deps.storage.list(courseAgentPrefix(communityId, courseId));
      if (stored.length === 0) continue;
      courseCount += 1;
      for (const object of stored) {
        if (
          keys.has(object.key) ||
          !isCourseAgentFileKey(object.key, communityId, courseId) ||
          now - object.lastModified.getTime() < graceMs
        ) {
          continue;
        }
        await deps.storage.delete(object.key);
        deleted += 1;
        bytes += object.size;
      }
    }
  }
  return { courses: courseCount, deleted, bytes };
}

export function collectDefaultAgentFileGarbage(): Promise<AgentFileGarbageResult> {
  return collectAgentFileGarbage({ db: getDb(), storage: getStorage() });
}
