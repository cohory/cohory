import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createOutboxRelayHandler,
  OUTBOX_RELAY,
  outboxRelayBatch,
  outboxRelayCron,
  type OutboxRelayDeps,
} from "./jobs/outbox-relay";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000001",
  name: OUTBOX_RELAY,
  data: {},
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

function relayDeps(results: { published: number; failed: number }[]): OutboxRelayDeps {
  const queue = [...results];
  return {
    relay: vi.fn(async () => {
      const next = queue.shift() ?? { published: 0, failed: 0 };
      return { ...next, errors: Array.from({ length: next.failed }, () => "Error") };
    }),
    prune: vi.fn(async () => 3),
    now: () => new Date("2026-10-18T10:00:00Z"),
  };
}

describe("outbox.relay job", () => {
  it("is scheduled every minute with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(OUTBOX_RELAY, { policy: "stately" });
    expect(work).toHaveBeenCalledWith(OUTBOX_RELAY, expect.any(Function));
    expect(schedule).toHaveBeenCalledWith(OUTBOX_RELAY, outboxRelayCron);
  });

  it("keeps relaying full batches and then prunes rows published a week ago", async () => {
    const deps = relayDeps([
      { published: outboxRelayBatch, failed: 0 },
      { published: 2, failed: 1 },
    ]);

    await createOutboxRelayHandler(silentLogger, deps)([job]);

    expect(deps.relay).toHaveBeenCalledTimes(2);
    expect(deps.relay).toHaveBeenCalledWith(outboxRelayBatch);
    expect(deps.prune).toHaveBeenCalledWith(new Date("2026-10-11T10:00:00Z"));
  });

  it("lets a relay error fail the job so pg-boss records it", async () => {
    const deps: OutboxRelayDeps = {
      relay: vi.fn(async () => {
        throw new Error("db down");
      }),
      prune: vi.fn(async () => 0),
      now: () => new Date(),
    };

    await expect(createOutboxRelayHandler(silentLogger, deps)([job])).rejects.toThrow("db down");
    expect(deps.prune).not.toHaveBeenCalled();
  });
});
