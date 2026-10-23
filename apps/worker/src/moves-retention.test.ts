import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createMovesRetentionHandler,
  PAYMENTS_MOVES_RETENTION,
  type SweepSubscriberMoves,
} from "./jobs/payments-moves-retention";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000005",
  name: PAYMENTS_MOVES_RETENTION,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("payments.moves-retention job", () => {
  it("runs daily with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_MOVES_RETENTION, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_MOVES_RETENTION, "23 4 * * *");
  });

  it("runs one sweep per job and lets failures reject", async () => {
    const run = vi.fn<SweepSubscriberMoves>().mockResolvedValue({ removed: 3 });
    await createMovesRetentionHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<SweepSubscriberMoves>().mockRejectedValue(new Error("db down"));
    await expect(createMovesRetentionHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
