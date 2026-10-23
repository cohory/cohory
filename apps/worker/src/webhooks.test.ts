import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createWebhooksDeliverHandler,
  createWebhooksFanoutHandler,
  createWebhooksSweepHandler,
  WEBHOOKS_DELIVER,
  WEBHOOKS_FANOUT,
  WEBHOOKS_SWEEP,
  type WebhookJobsDeps,
} from "./jobs/webhooks";

const logger = createLogger({ level: "silent" });
const community = "0192f0a0-0000-7000-8000-00000000c001";
const user = "0192f0a0-0000-7000-8000-000000000001";
const delivery = "0192f0a0-0000-7000-8000-00000000d001";

function job(name: string, data: unknown): Job<unknown> {
  return { id: "01900000-0000-7000-8000-000000000000", name, data } as Job<unknown>;
}

function deps(): { [K in keyof WebhookJobsDeps]: ReturnType<typeof vi.fn<WebhookJobsDeps[K]>> } {
  return {
    fanout: vi.fn<WebhookJobsDeps["fanout"]>().mockResolvedValue({ created: 2 }),
    deliver: vi
      .fn<WebhookJobsDeps["deliver"]>()
      .mockResolvedValue({ kind: "succeeded", status: 200 }),
    sweep: vi.fn<WebhookJobsDeps["sweep"]>().mockResolvedValue({ enqueued: 0 }),
  };
}

describe("webhook job handlers", () => {
  it("fans out a parsed outbox payload and rejects a malformed one", async () => {
    const jobs = deps();
    const handler = createWebhooksFanoutHandler(logger, jobs);
    const payload = {
      outboxId: delivery,
      communityId: community,
      events: [
        {
          type: "member.joined",
          payload: {
            communityId: community,
            userId: user,
            role: "member",
            occurredAt: "2026-10-19T08:00:00.000Z",
          },
        },
      ],
    };
    await handler([job(WEBHOOKS_FANOUT, payload)]);
    expect(jobs.fanout).toHaveBeenCalledWith(payload);
    await expect(handler([job(WEBHOOKS_FANOUT, { outboxId: "x" })])).rejects.toThrow();
  });

  it("delivers by id and rejects a job without one", async () => {
    const jobs = deps();
    const handler = createWebhooksDeliverHandler(logger, jobs);
    await handler([job(WEBHOOKS_DELIVER, { deliveryId: delivery })]);
    expect(jobs.deliver).toHaveBeenCalledWith(delivery);
    await expect(handler([job(WEBHOOKS_DELIVER, {})])).rejects.toThrow();
  });

  it("sweeps due deliveries", async () => {
    const jobs = deps();
    await createWebhooksSweepHandler(logger, jobs)([job(WEBHOOKS_SWEEP, null)]);
    expect(jobs.sweep).toHaveBeenCalledTimes(1);
  });
});
