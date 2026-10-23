import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createLastSeenBackfillHandler,
  MEMBERS_LAST_SEEN_BACKFILL,
  type BackfillLastSeen,
} from "./jobs/members-last-seen";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000005",
  name: MEMBERS_LAST_SEEN_BACKFILL,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("members.last-seen-backfill job", () => {
  it("runs daily with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(MEMBERS_LAST_SEEN_BACKFILL, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(MEMBERS_LAST_SEEN_BACKFILL, "23 4 * * *");
  });

  it("runs one backfill pass per job and lets failures reject", async () => {
    const run = vi
      .fn<BackfillLastSeen>()
      .mockResolvedValue({ communities: 2, updated: 7, batches: 3 });
    await createLastSeenBackfillHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<BackfillLastSeen>().mockRejectedValue(new Error("db down"));
    await expect(createLastSeenBackfillHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
