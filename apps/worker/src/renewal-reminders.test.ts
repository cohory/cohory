import { renewalReminderQueueOptions } from "@cohory/payments";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createRenewalReminderHandler,
  createRenewalRemindersHandler,
  PAYMENTS_RENEWAL_REMINDER,
  PAYMENTS_RENEWAL_REMINDERS,
  type PrepareRenewalReminder,
  type QueueRenewalReminders,
  type SendRenewalEmail,
} from "./jobs/payments-renewal-reminders";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

function job(name: string, data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000041",
    name,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

const reminder = {
  subscriptionId: "01900000-0000-7000-8000-000000000001",
  communityId: "01900000-0000-7000-8000-000000000002",
  renewsAt: "2026-11-18T10:00:00.000Z",
};

const message = {
  email: "ana@example.test",
  communityName: "Makers",
  communitySlug: "makers",
  amountMinor: 29000,
  currency: "usd",
  renewsAt: new Date("2026-11-18T10:00:00.000Z"),
};

describe("renewal reminder jobs", () => {
  it("sweeps once a day and keeps sent reminder jobs long enough to block repeats", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_RENEWAL_REMINDERS, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(PAYMENTS_RENEWAL_REMINDERS, "41 9 * * *");
    expect(createQueue).toHaveBeenCalledWith(
      PAYMENTS_RENEWAL_REMINDER,
      renewalReminderQueueOptions,
    );
  });

  it("queues the due reminders on each sweep", async () => {
    const run = vi.fn<QueueRenewalReminders>().mockResolvedValue({ queued: 2 });

    await createRenewalRemindersHandler(silentLogger, run)([job(PAYMENTS_RENEWAL_REMINDERS, null)]);

    expect(run).toHaveBeenCalledOnce();
  });

  it("emails the member the date, the amount, and a link read at send time", async () => {
    const prepare = vi.fn<PrepareRenewalReminder>().mockResolvedValue(message);
    const send = vi.fn<SendRenewalEmail>().mockResolvedValue(undefined);

    await createRenewalReminderHandler(
      silentLogger,
      "https://cohory.test",
      prepare,
      send,
    )([job(PAYMENTS_RENEWAL_REMINDER, reminder)]);

    expect(prepare).toHaveBeenCalledWith(reminder);
    const [sent] = send.mock.calls[0] ?? [];
    expect(sent?.to).toBe("ana@example.test");
    expect(sent?.subject).toBe("[Makers] Your membership renews on November 18, 2026");
    expect(sent?.text).toContain("https://cohory.test/c/makers/membership");
  });

  it("sends nothing when the subscription no longer renews or the member is gone", async () => {
    const prepare = vi.fn<PrepareRenewalReminder>().mockResolvedValue(null);
    const send = vi.fn<SendRenewalEmail>();

    await createRenewalReminderHandler(
      silentLogger,
      "https://cohory.test",
      prepare,
      send,
    )([job(PAYMENTS_RENEWAL_REMINDER, reminder)]);

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a payload that carries personal data instead of sending", async () => {
    const prepare = vi.fn<PrepareRenewalReminder>();
    const send = vi.fn<SendRenewalEmail>();

    await expect(
      createRenewalReminderHandler(
        silentLogger,
        "https://cohory.test",
        prepare,
        send,
      )([job(PAYMENTS_RENEWAL_REMINDER, { ...reminder, email: "ana@example.test" })]),
    ).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
