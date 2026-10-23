import { memberBillingEndQueueOptions } from "@cohory/payments";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createPaymentsMemberBillingEndHandler,
  PAYMENTS_MEMBER_BILLING_END,
} from "./jobs/payments-member-billing";
import type { JobDeps } from "./services";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });
const payload = {
  communityId: "01900000-0000-7000-8000-000000000011",
  userId: "01900000-0000-7000-8000-000000000013",
  kind: "banned",
} as const;

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000012",
    name: PAYMENTS_MEMBER_BILLING_END,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("payments.member-billing-end job", () => {
  it("registers payments.member-billing-end with 8 retries and backoff", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      silentLogger,
    );

    expect(memberBillingEndQueueOptions).toEqual({ retryLimit: 8, retryBackoff: true });
    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_MEMBER_BILLING_END, {
      retryLimit: 8,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(PAYMENTS_MEMBER_BILLING_END, expect.any(Function));
  });

  it("ends the billing of the member named by the payload", async () => {
    const end = vi.fn<JobDeps["endBillingForRemovedMember"]>().mockResolvedValue({ canceled: 1 });

    await createPaymentsMemberBillingEndHandler(silentLogger, end)([job(payload)]);

    expect(end).toHaveBeenCalledWith(payload);
  });

  it("fails the job so pg-boss retries it when the cancel fails", async () => {
    const end = vi
      .fn<JobDeps["endBillingForRemovedMember"]>()
      .mockRejectedValue(new Error("stripe is down"));

    await expect(
      createPaymentsMemberBillingEndHandler(silentLogger, end)([job(payload)]),
    ).rejects.toThrow("stripe is down");
  });

  it("rejects a malformed payload", async () => {
    const end = vi.fn<JobDeps["endBillingForRemovedMember"]>();

    await expect(
      createPaymentsMemberBillingEndHandler(silentLogger, end)([job({ ...payload, kind: "left" })]),
    ).rejects.toThrow();
    expect(end).not.toHaveBeenCalled();
  });
});
