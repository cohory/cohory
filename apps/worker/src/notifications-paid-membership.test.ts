import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createNotificationsPaidMembershipHandler,
  NOTIFICATIONS_PAID_MEMBERSHIP,
} from "./jobs/notifications-paid-membership";
import type { JobDeps } from "./services";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000007",
    name: NOTIFICATIONS_PAID_MEMBERSHIP,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

const event = {
  type: "paid_membership.changed",
  payload: {
    noticeId: "0192f2a4-0000-7000-8000-0000000000bb",
    communityId: "0192f2a4-0000-7000-8000-000000000001",
    communitySlug: "makers",
    communityName: "Makers",
    actorId: "0192f2a4-0000-7000-8000-000000000002",
    change: "archived_continuing",
    supportContact: null,
    portalLoginUrl: null,
    recipients: [{ userId: "0192f2a4-0000-7000-8000-000000000003", endsAt: null }],
  },
};

describe("notifications.paid-membership job", () => {
  it("registers notifications.paid-membership with retries", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      silentLogger,
    );

    expect(createQueue).toHaveBeenCalledWith(NOTIFICATIONS_PAID_MEMBERSHIP, {
      retryLimit: 5,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(NOTIFICATIONS_PAID_MEMBERSHIP, expect.any(Function));
  });

  it("passes parsed events to the notifier", async () => {
    const notify = vi
      .fn<JobDeps["notifyPaidMembership"]>()
      .mockResolvedValue({ inserted: 1, emailed: 1 });

    await createNotificationsPaidMembershipHandler(
      silentLogger,
      notify,
    )([job({ events: [event] })]);

    expect(notify).toHaveBeenCalledWith([event]);
  });

  it("rejects a malformed payload so pg-boss retries and records it", async () => {
    const notify = vi.fn<JobDeps["notifyPaidMembership"]>();
    await expect(
      createNotificationsPaidMembershipHandler(silentLogger, notify)([job({ events: [{}] })]),
    ).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
