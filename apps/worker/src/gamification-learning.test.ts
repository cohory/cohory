import type { LearningActivity } from "@cohory/gamification";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  awardLearningPoints,
  createLearningPointsHandler,
  GAMIFICATION_LEARNING_POINTS,
  learningLookbackMs,
  learningPointsCron,
  type LearningPointsSources,
} from "./jobs/gamification-learning";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });
const now = new Date("2026-10-22T12:00:00.000Z");
const after = new Date(now.getTime() - learningLookbackMs);
const lessonsOnly = "01900000-0000-7000-8000-00000000000a";
const eventsOnly = "01900000-0000-7000-8000-00000000000b";

function sources(): LearningPointsSources & {
  record: ReturnType<typeof vi.fn<LearningPointsSources["record"]>>;
} {
  return {
    communities: async () => [
      { communityId: lessonsOnly, lessons: true, events: false },
      { communityId: eventsOnly, lessons: false, events: true },
    ],
    lessonCompletions: vi.fn<LearningPointsSources["lessonCompletions"]>(async () => [
      { userId: "u1", lessonId: "l1", completedAt: now },
    ]),
    attendance: vi.fn<LearningPointsSources["attendance"]>(async () => [
      { userId: "u2", occurrenceId: "o1", endedAt: now },
    ]),
    record: vi.fn<LearningPointsSources["record"]>(async (_id, activities) => ({
      inserted: activities.length,
    })),
    now: () => now,
  };
}

describe("gamification.learning-points job", () => {
  it("runs every 15 minutes with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(GAMIFICATION_LEARNING_POINTS, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(GAMIFICATION_LEARNING_POINTS, learningPointsCron);
    expect(learningPointsCron).toBe("*/15 * * * *");
  });

  it("reads only the activities each community turned on and records them there", async () => {
    const deps = sources();

    const result = await awardLearningPoints(deps);

    expect(result).toEqual({ communities: 2, inserted: 2, failed: 0 });
    expect(deps.lessonCompletions).toHaveBeenCalledExactlyOnceWith(lessonsOnly, after, now);
    expect(deps.attendance).toHaveBeenCalledExactlyOnceWith(eventsOnly, after, now);
    const lessonActivity: LearningActivity = {
      kind: "lesson",
      userId: "u1",
      sourceId: "l1",
      occurredAt: now,
    };
    const eventActivity: LearningActivity = {
      kind: "event",
      userId: "u2",
      sourceId: "o1",
      occurredAt: now,
    };
    expect(deps.record.mock.calls).toEqual([
      [lessonsOnly, [lessonActivity]],
      [eventsOnly, [eventActivity]],
    ]);
  });

  it("keeps going when one community fails and reports it by id only", async () => {
    const deps = sources();
    deps.record.mockRejectedValueOnce(new TypeError("boom for u1"));
    const failures: [string, unknown][] = [];

    const result = await awardLearningPoints({
      ...deps,
      onCommunityError: (communityId, error) => failures.push([communityId, error]),
    });

    expect(result).toEqual({ communities: 2, inserted: 1, failed: 1 });
    expect(deps.record).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[0]).toBe(lessonsOnly);
  });

  it("runs one pass per job and lets failures reject", async () => {
    const job = {
      id: "01900000-0000-7000-8000-000000000006",
      name: GAMIFICATION_LEARNING_POINTS,
      data: null,
      expireInSeconds: 60,
      heartbeatSeconds: null,
      retryCount: 0,
    } as Job<unknown>;
    const run = vi.fn(async () => ({ communities: 0, inserted: 0, failed: 0 }));
    await createLearningPointsHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn(async () => Promise.reject(new Error("db down")));
    await expect(createLearningPointsHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
