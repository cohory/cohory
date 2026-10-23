import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createNotificationEmailHandler,
  NOTIFICATIONS_DIGEST,
  NOTIFICATIONS_EMAIL,
  type SendNotificationEmails,
} from "./jobs/notifications-email";
import { NOTIFICATIONS_WEEKLY_DIGEST } from "./jobs/notifications-weekly-digest";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000002",
  name: NOTIFICATIONS_EMAIL,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("notification email jobs", () => {
  it("schedules immediate email every minute and daily and weekly digests every 15 minutes", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(NOTIFICATIONS_EMAIL, { policy: "stately" });
    expect(createQueue).toHaveBeenCalledWith(NOTIFICATIONS_DIGEST, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(NOTIFICATIONS_EMAIL, "* * * * *");
    expect(schedule).toHaveBeenCalledWith(NOTIFICATIONS_DIGEST, "*/15 * * * *");
    expect(createQueue).toHaveBeenCalledWith(NOTIFICATIONS_WEEKLY_DIGEST, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(NOTIFICATIONS_WEEKLY_DIGEST, "*/15 * * * *");
  });

  it("runs one pass per job", async () => {
    const run = vi
      .fn<SendNotificationEmails>()
      .mockResolvedValue({ users: 1, sent: 1, skipped: 0, failed: 0 });

    await createNotificationEmailHandler(silentLogger, run, "sent")([job, job]);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets a failed pass reject so pg-boss records it", async () => {
    const run = vi.fn<SendNotificationEmails>().mockRejectedValue(new Error("db down"));

    await expect(createNotificationEmailHandler(silentLogger, run, "sent")([job])).rejects.toThrow(
      "db down",
    );
  });
});
