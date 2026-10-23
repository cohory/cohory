import type { Attendance } from "@cohory/calendar";
import type { LessonCompletion } from "@cohory/courses";
import type { LearningActivity, LearningPointsCommunity, PointsResult } from "@cohory/gamification";
import type { Job } from "pg-boss";

import type { JobDefinition } from "./definition";
import type { Logger } from "../logger";

export const GAMIFICATION_LEARNING_POINTS = "gamification.learning-points";
export const learningPointsCron = "*/15 * * * *";
// Each run looks back two days, so a worker that was down for a while catches up. The
// ledger counts each lesson or occurrence once, so the overlap between runs adds nothing.
export const learningLookbackMs = 2 * 24 * 60 * 60 * 1000;

export interface LearningPointsSources {
  communities(): Promise<LearningPointsCommunity[]>;
  lessonCompletions(communityId: string, after: Date, until: Date): Promise<LessonCompletion[]>;
  attendance(communityId: string, after: Date, until: Date): Promise<Attendance[]>;
  record(communityId: string, activities: readonly LearningActivity[]): Promise<PointsResult>;
  onCommunityError?(communityId: string, error: unknown): void;
  now?(): Date;
}

export interface LearningPointsResult {
  readonly communities: number;
  readonly inserted: number;
  readonly failed: number;
}

export type AwardLearningPoints = () => Promise<LearningPointsResult>;

export async function awardLearningPoints(
  sources: LearningPointsSources,
): Promise<LearningPointsResult> {
  const until = sources.now?.() ?? new Date();
  const after = new Date(until.getTime() - learningLookbackMs);
  const communities = await sources.communities();
  let inserted = 0;
  let failed = 0;
  for (const community of communities) {
    try {
      inserted += await awardCommunity(sources, community, after, until);
    } catch (error) {
      failed += 1;
      sources.onCommunityError?.(community.communityId, error);
    }
  }
  return { communities: communities.length, inserted, failed };
}

async function awardCommunity(
  sources: LearningPointsSources,
  { communityId, lessons, events }: LearningPointsCommunity,
  after: Date,
  until: Date,
): Promise<number> {
  const activities: LearningActivity[] = [
    ...(lessons ? await sources.lessonCompletions(communityId, after, until) : []).map(
      (row): LearningActivity => ({
        kind: "lesson",
        userId: row.userId,
        sourceId: row.lessonId,
        occurredAt: row.completedAt,
      }),
    ),
    ...(events ? await sources.attendance(communityId, after, until) : []).map(
      (row): LearningActivity => ({
        kind: "event",
        userId: row.userId,
        sourceId: row.occurrenceId,
        occurredAt: row.endedAt,
      }),
    ),
  ];
  if (activities.length === 0) return 0;
  return (await sources.record(communityId, activities)).inserted;
}

export function createLearningPointsHandler(logger: Logger, run: AwardLearningPoints) {
  return async (batch: Job<unknown>[]): Promise<void> => {
    for (const job of batch) {
      const result = await run();
      logger.info({ jobId: job.id, job: job.name, ...result }, "learning points recorded");
    }
  };
}

export const learningPointsJobDefinition: JobDefinition = {
  name: GAMIFICATION_LEARNING_POINTS,
  queueOptions: { policy: "stately" },
  cron: learningPointsCron,
  handler: ({ logger, deps }) => createLearningPointsHandler(logger, deps.awardLearningPoints),
};
