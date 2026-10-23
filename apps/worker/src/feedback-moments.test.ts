import { createLogger } from "@cohory/infra/logger";
import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  createFeedbackMomentsHandler,
  createFeedbackRetentionHandler,
  FEEDBACK_MOMENTS,
  FEEDBACK_RETENTION,
  isFirstMoment,
  type MomentCounts,
  type RecordMoment,
  type RemoveExpiredFeedback,
} from "./jobs/feedback-moments";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });
const community = "01900000-0000-7000-8000-00000000000a";

function job(data: unknown): Job<unknown> {
  return { id: "job-1", name: FEEDBACK_MOMENTS, data } as Job<unknown>;
}

describe("feedback moments job", () => {
  it("records each moment from the job payload", async () => {
    const record = vi.fn<RecordMoment>(async () => "recorded");

    await createFeedbackMomentsHandler(
      silentLogger,
      record,
    )([job({ communityId: community, moment: "first_post" })]);

    expect(record).toHaveBeenCalledWith({ communityId: community, moment: "first_post" });
  });

  it("rejects a payload that is not a known moment", async () => {
    const record = vi.fn<RecordMoment>(async () => "recorded");

    await expect(
      createFeedbackMomentsHandler(
        silentLogger,
        record,
      )([job({ communityId: community, moment: "first_event" })]),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("isFirstMoment", () => {
  const counts: MomentCounts = {
    posts: async () => 1,
    courses: async () => 2,
    paidMembers: async () => 0,
  };

  it("asks the owning module for its count and treats exactly one as the first", async () => {
    expect(await isFirstMoment(counts, community, "first_post")).toBe(true);
    expect(await isFirstMoment(counts, community, "first_course")).toBe(false);
    expect(await isFirstMoment(counts, community, "first_paid_member")).toBe(false);
  });
});

describe("feedback retention job", () => {
  it("runs daily with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(FEEDBACK_RETENTION, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(FEEDBACK_RETENTION, "41 4 * * *");
  });

  it("removes expired feedback once per job and lets failures reject", async () => {
    const run = vi.fn<RemoveExpiredFeedback>().mockResolvedValue(2);
    await createFeedbackRetentionHandler(silentLogger, run)([job(null)]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<RemoveExpiredFeedback>().mockRejectedValue(new Error("db down"));
    await expect(
      createFeedbackRetentionHandler(silentLogger, failing)([job(null)]),
    ).rejects.toThrow("db down");
  });
});
