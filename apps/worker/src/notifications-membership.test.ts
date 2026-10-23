import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createNotificationsMembershipHandler,
  NOTIFICATIONS_MEMBERSHIP,
} from "./jobs/notifications-membership";

const silentLogger = createLogger({ level: "silent" });

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000005",
    name: NOTIFICATIONS_MEMBERSHIP,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("notifications.membership job", () => {
  it("passes parsed join request events to the notifier", async () => {
    const notify = vi.fn().mockResolvedValue({ inserted: 2 });
    const events = [
      {
        type: "join_request.created",
        payload: {
          communityId: "0192f2a4-0000-7000-8000-000000000001",
          requestId: "0192f2a4-0000-7000-8000-000000000002",
          userId: "0192f2a4-0000-7000-8000-000000000003",
        },
      },
    ];

    await createNotificationsMembershipHandler(silentLogger, notify)([job({ events })]);

    expect(notify).toHaveBeenCalledWith(events);
  });

  it("rejects a malformed payload so pg-boss retries and records it", async () => {
    const notify = vi.fn();
    await expect(
      createNotificationsMembershipHandler(silentLogger, notify)([job({ events: [{}] })]),
    ).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
