import { communities, courseModules, courses, lessonProgress, lessons } from "@cohory/db/schema";
import { eq } from "drizzle-orm";

import { actAs } from "../scope";
import { restoreAgentMaterial } from "./agent-material";
import { date, dateOrNull, isHttpsUrl, type RestoreContext } from "./restore-context";

export async function restoreCourses(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, slugs, rewriteKey } = ctx;
  await phase(
    "courses",
    records.courses,
    (row) => row.id,
    async (tx, items) => {
      const values = items.map(({ row, id }) => ({
        id,
        communityId: target,
        slug: slugs.course(row.id) ?? row.slug,
        title: row.title,
        description: row.description,
        coverKey: rewriteKey(row.coverKey),
        status: row.status,
        position: row.position,
        access: row.access,
        requiredLevel: row.requiredLevel ?? null,
        createdAt: date(row.createdAt),
        updatedAt: date(row.updatedAt),
      }));
      if (values.length > 0) {
        await tx.insert(courses).values(values);
      }
      return new Set<string>();
    },
  );

  await phase(
    "course_modules",
    records.course_modules,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const courseId = map.get("courses", row.courseId);
        if (!courseId) {
          skips.add("course_modules", row.id, "The course is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          courseId,
          title: row.title,
          position: row.position,
        });
      }
      if (values.length > 0) {
        await tx.insert(courseModules).values(values);
      }
      return skipped;
    },
  );
}

export async function restoreLessons(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, slugs, rewriteKey, user } = ctx;
  await phase(
    "lessons",
    records.lessons,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const courseId = map.get("courses", row.courseId);
        const moduleId = map.get("course_modules", row.moduleId);
        if (!courseId || !moduleId) {
          skips.add("lessons", row.id, "The course or module is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        const attachments = [];
        for (const attachment of row.attachments) {
          const key = rewriteKey(attachment.key);
          if (key) attachments.push({ ...attachment, key });
          else
            skips.add("lessons.attachment", row.id, "The attachment file is not in the archive.");
        }
        if (row.videoUrl && !isHttpsUrl(row.videoUrl)) {
          skips.add("lessons.video", row.id, "The video link is not an https link.");
        }
        values.push({
          id,
          communityId: target,
          courseId,
          moduleId,
          slug: slugs.lesson(row.id) ?? row.slug,
          title: row.title,
          bodyMarkdown: row.bodyMarkdown,
          videoUrl: isHttpsUrl(row.videoUrl) ? row.videoUrl : null,
          attachments,
          status: row.status,
          position: row.position,
          createdAt: date(row.createdAt),
          updatedAt: date(row.updatedAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(lessons).values(values);
      }
      return skipped;
    },
  );

  await phase(
    "lesson_progress",
    records.lesson_progress,
    (row) => `${row.lessonId}:${row.userId}`,
    async (tx, items) => {
      const skipped = new Set<string>();
      const byUser = new Map<string, (typeof lessonProgress.$inferInsert)[]>();
      for (const { row } of items) {
        const sourceKey = `${row.lessonId}:${row.userId}`;
        const lessonId = map.get("lessons", row.lessonId);
        const courseId = map.get("courses", row.courseId);
        const userId = user(row.userId);
        if (!lessonId || !courseId || !userId) {
          skips.add(
            "lesson_progress",
            sourceKey,
            "The lesson or the person is not in the archive.",
          );
          skipped.add(sourceKey);
          continue;
        }
        const list = byUser.get(userId) ?? [];
        list.push({
          communityId: target,
          lessonId,
          courseId,
          userId,
          completedAt: dateOrNull(row.completedAt),
          lastViewedAt: date(row.lastViewedAt),
        });
        byUser.set(userId, list);
      }
      for (const [userId, values] of byUser) {
        await actAs(tx, userId);
        await tx.insert(lessonProgress).values(values).onConflictDoNothing();
      }
      return skipped;
    },
  );
}

export async function restoreCourseAgentMaterial(ctx: RestoreContext): Promise<void> {
  const { deps, records, archive, target, map, skips, scope, phase, slugs, rewriteKey } = ctx;
  const targetSlug = await scope(async (tx) => {
    const [row] = await tx
      .select({ slug: communities.slug })
      .from(communities)
      .where(eq(communities.id, target));
    return row?.slug ?? archive.manifest.community.slug;
  });
  await restoreAgentMaterial(
    {
      phase,
      map,
      skips,
      target,
      rewriteKey: (key) => rewriteKey(key),
      sourceUrl: (sourceCourseId, snapshotSlug, original) =>
        `${deps.appUrl?.replace(/\/+$/, "") ?? new URL(original).origin}/c/${targetSlug}/classroom/${slugs.course(sourceCourseId) ?? snapshotSlug}`,
    },
    {
      layers: records.lesson_agent_layers,
      versions: records.course_agent_versions,
      settings: records.course_agent_settings,
    },
  );
}
