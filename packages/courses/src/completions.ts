import {
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { lessonProgress } from "@cohory/db/schema";
import { asc, gt, isNotNull, lte } from "drizzle-orm";

export interface LessonCompletion {
  readonly userId: string;
  readonly lessonId: string;
  readonly completedAt: Date;
}

export function lessonCompletionsBetween(
  db: Database,
  communityId: CommunityId,
  after: Date,
  until: Date,
): Promise<LessonCompletion[]> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    await setRlsFlag(tx, "course_manager");
    const rows = await tx
      .select({
        userId: lessonProgress.userId,
        lessonId: lessonProgress.lessonId,
        completedAt: lessonProgress.completedAt,
      })
      .from(lessonProgress)
      .where(
        where(
          lessonProgress,
          isNotNull(lessonProgress.completedAt),
          gt(lessonProgress.completedAt, after),
          lte(lessonProgress.completedAt, until),
        ),
      )
      .orderBy(asc(lessonProgress.completedAt), asc(lessonProgress.userId));
    return rows.flatMap((row) =>
      row.completedAt ? [{ ...row, completedAt: row.completedAt }] : [],
    );
  });
}
