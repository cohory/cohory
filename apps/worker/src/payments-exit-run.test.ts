import { parseCommunityId } from "@cohory/db";
import {
  ExitRunIncompleteError,
  exitRunQueueOptions,
  PaymentsNotFoundError,
} from "@cohory/payments";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import { createPaymentsExitRunHandler, PAYMENTS_EXIT_RUN } from "./jobs/payments-exit-run";
import type { JobDeps } from "./services";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });
const payload = {
  runId: "01900000-0000-7000-8000-000000000010",
  communityId: "01900000-0000-7000-8000-000000000011",
};

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000012",
    name: PAYMENTS_EXIT_RUN,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("payments.exit-run job", () => {
  it("registers payments.exit-run with 8 retries and backoff", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      silentLogger,
    );

    expect(exitRunQueueOptions).toEqual({ retryLimit: 8, retryBackoff: true });
    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_EXIT_RUN, {
      retryLimit: 8,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(PAYMENTS_EXIT_RUN, expect.any(Function));
  });

  it("runs the exit run named by the payload", async () => {
    const runExit = vi.fn<JobDeps["runExitRun"]>().mockResolvedValue({
      kind: "archive",
      status: "done",
      communityId: parseCommunityId(payload.communityId),
    });

    await createPaymentsExitRunHandler(
      silentLogger,
      runExit,
      vi.fn<JobDeps["completeCommunityDeletion"]>(),
    )([job(payload)]);

    expect(runExit).toHaveBeenCalledWith(payload);
  });

  it("throws while subscriptions are not done so pg-boss retries", async () => {
    const runExit = vi
      .fn<JobDeps["runExitRun"]>()
      .mockRejectedValue(new ExitRunIncompleteError(payload.runId, 1));

    await expect(
      createPaymentsExitRunHandler(
        silentLogger,
        runExit,
        vi.fn<JobDeps["completeCommunityDeletion"]>(),
      )([job(payload)]),
    ).rejects.toBeInstanceOf(ExitRunIncompleteError);
  });

  it("stops retrying when the community or run is gone", async () => {
    const runExit = vi
      .fn<JobDeps["runExitRun"]>()
      .mockRejectedValue(new PaymentsNotFoundError("exit_run"));

    await expect(
      createPaymentsExitRunHandler(
        silentLogger,
        runExit,
        vi.fn<JobDeps["completeCommunityDeletion"]>(),
      )([job(payload)]),
    ).resolves.toBeUndefined();
  });

  it("deletes the community after a done delete run and not after a failed one", async () => {
    const communityId = parseCommunityId(payload.communityId);
    const completeDeletion = vi
      .fn<JobDeps["completeCommunityDeletion"]>()
      .mockResolvedValue("deleted");
    const runExit = vi
      .fn<JobDeps["runExitRun"]>()
      .mockResolvedValueOnce({ kind: "delete", status: "failed", communityId })
      .mockResolvedValueOnce({ kind: "archive", status: "done", communityId })
      .mockResolvedValueOnce({ kind: "delete", status: "done", communityId });
    const handler = createPaymentsExitRunHandler(silentLogger, runExit, completeDeletion);

    await handler([job(payload)]);
    await handler([job(payload)]);
    expect(completeDeletion).not.toHaveBeenCalled();

    await handler([job(payload)]);
    expect(completeDeletion).toHaveBeenCalledExactlyOnceWith(communityId);
  });

  it("rejects a malformed payload", async () => {
    const runExit = vi.fn<JobDeps["runExitRun"]>();
    await expect(
      createPaymentsExitRunHandler(
        silentLogger,
        runExit,
        vi.fn<JobDeps["completeCommunityDeletion"]>(),
      )([job({ runId: "x" })]),
    ).rejects.toThrow();
    expect(runExit).not.toHaveBeenCalled();
  });
});
