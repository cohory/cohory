import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createNotificationsDomainHandler,
  NOTIFICATIONS_DOMAIN,
} from "./jobs/notifications-domain";

const silentLogger = createLogger({ level: "silent" });

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000006",
    name: NOTIFICATIONS_DOMAIN,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("notifications.domain job", () => {
  it("passes parsed join events to the notifier", async () => {
    const notify = vi.fn().mockResolvedValue({ inserted: 1 });
    const events = [
      {
        type: "member.joined",
        payload: {
          communityId: "0192f2a4-0000-7000-8000-000000000001",
          userId: "0192f2a4-0000-7000-8000-000000000003",
          role: "member",
          occurredAt: "2026-10-22T08:00:00.000Z",
        },
      },
    ];

    await createNotificationsDomainHandler(silentLogger, notify)([job({ events })]);

    expect(notify).toHaveBeenCalledWith(events);
  });

  it("rejects a malformed payload so pg-boss retries and records it", async () => {
    const notify = vi.fn();
    await expect(
      createNotificationsDomainHandler(silentLogger, notify)([job({ events: [{}] })]),
    ).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
