import { parseCommunityId } from "@cohory/db";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  COMMUNITIES_PURGE,
  createCommunitiesPurgeHandler,
  type PurgeDeletedCommunities,
} from "./jobs/communities-purge";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000031",
  name: COMMUNITIES_PURGE,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("communities.purge-deleted job", () => {
  it("runs every minute with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(COMMUNITIES_PURGE, { policy: "stately" });
    expect(work).toHaveBeenCalledWith(COMMUNITIES_PURGE, expect.any(Function));
    expect(schedule).toHaveBeenCalledWith(COMMUNITIES_PURGE, "* * * * *");
  });

  it("logs each community it could not purge and lets a failed run reject", async () => {
    const logger = createLogger({ level: "silent" });
    const error = vi.spyOn(logger, "error");
    const run = vi.fn<PurgeDeletedCommunities>().mockResolvedValue({
      purged: 1,
      notReady: 0,
      failed: [{ communityId: parseCommunityId(job.id), code: "deletion_conflict" }],
    });

    await createCommunitiesPurgeHandler(logger, run)([job]);

    expect(run).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "deletion_conflict" }),
      "deleted community not purged",
    );
    const failing = vi.fn<PurgeDeletedCommunities>().mockRejectedValue(new Error("db down"));
    await expect(createCommunitiesPurgeHandler(logger, failing)([job])).rejects.toThrow("db down");
  });
});
