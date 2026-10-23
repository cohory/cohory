import { assertCan, type Actor } from "@cohory/authz";
import { prefixTsQuery, splitHighlights, type ExcerptSegment } from "@cohory/db";

import { unlockedOnly, withAccess, type Runtime } from "./context";

export interface LessonSearchHit {
  readonly courseSlug: string;
  readonly courseTitle: string;
  readonly lessonSlug: string;
  readonly lessonTitle: string;
  readonly excerpt: readonly ExcerptSegment[];
}

export interface SearchOperations {
  searchLessons(
    actor: Actor,
    communityId: string,
    query: string,
    limit: number,
  ): Promise<LessonSearchHit[]>;
}

export function createSearchOperations(runtime: Runtime): SearchOperations {
  return {
    async searchLessons(actor, communityId, query, limit) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "lesson", access.context);
        const tsQuery = prefixTsQuery(query);
        if (!tsQuery) {
          return [];
        }
        const published = await access.store.listCourses("published");
        const allowedSlugs = new Set(
          (await unlockedOnly(access, published))
            .filter((course) => access.agentCourseIds?.has(course.id) ?? true)
            .map((course) => course.slug.toLowerCase()),
        );
        const rows = (await access.store.searchPublishedLessons(tsQuery, limit)).filter((row) =>
          allowedSlugs.has(row.courseSlug.toLowerCase()),
        );
        return rows.map((row) => ({
          courseSlug: row.courseSlug,
          courseTitle: row.courseTitle,
          lessonSlug: row.lessonSlug,
          lessonTitle: row.lessonTitle,
          excerpt: splitHighlights(row.headline),
        }));
      });
    },
  };
}
