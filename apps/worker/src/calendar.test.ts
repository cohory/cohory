import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import { noticeQueueOptions, timeChangeQueueOptions } from "@cohory/calendar";

import {
  CALENDAR_EXTEND,
  CALENDAR_NOTICE,
  CALENDAR_REMINDERS,
  CALENDAR_TIME_CHANGE,
  createCalendarExtendHandler,
  createCalendarNoticeHandler,
  createCalendarRemindersHandler,
  createCalendarTimeChangeHandler,
} from "./jobs/calendar";
import type { JobDeps } from "./services";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

function fakeJob(name: string, data: unknown = null): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000000",
    name,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

function deps(): JobDeps {
  return {
    fanOutNotifications: vi.fn<JobDeps["fanOutNotifications"]>(),
    notifyMembership: vi.fn<JobDeps["notifyMembership"]>(),
    notifyJoins: vi.fn<JobDeps["notifyJoins"]>(),
    sendWelcomeEmail: vi.fn<JobDeps["sendWelcomeEmail"]>(),
    sendMemberEmail: vi.fn<JobDeps["sendMemberEmail"]>(),
    notifyPaidMembership: vi.fn<JobDeps["notifyPaidMembership"]>(),
    recordPoints: vi.fn<JobDeps["recordPoints"]>(),
    recordMoment: vi.fn<JobDeps["recordMoment"]>(),
    removeExpiredFeedback: vi.fn<JobDeps["removeExpiredFeedback"]>(),
    awardLearningPoints: vi.fn<JobDeps["awardLearningPoints"]>(),
    removeApplicationFees: vi.fn<JobDeps["removeApplicationFees"]>(),
    runExitRun: vi.fn<JobDeps["runExitRun"]>(),
    completeCommunityDeletion: vi.fn<JobDeps["completeCommunityDeletion"]>(),
    purgeDeletedCommunities: vi.fn<JobDeps["purgeDeletedCommunities"]>(),
    endBillingForRemovedMember: vi.fn<JobDeps["endBillingForRemovedMember"]>(),
    processPaymentWebhook: vi.fn<JobDeps["processPaymentWebhook"]>(),
    processBillingWebhook: vi.fn<JobDeps["processBillingWebhook"]>(),
    sweepWebhookEvents: vi.fn<JobDeps["sweepWebhookEvents"]>(),
    scheduleConnectionReconciles: vi.fn<JobDeps["scheduleConnectionReconciles"]>(),
    reconcileConnection: vi.fn<JobDeps["reconcileConnection"]>(),
    sendDueReminders: vi
      .fn<JobDeps["sendDueReminders"]>()
      .mockResolvedValue({ sent: 2, failed: 0 }),
    extendSeries: vi
      .fn<JobDeps["extendSeries"]>()
      .mockResolvedValue({ communities: 1, inserted: 3 }),
    notifyTimeChange: vi
      .fn<JobDeps["notifyTimeChange"]>()
      .mockResolvedValue({ sent: 1, failed: 0 }),
    sendCalendarNotice: vi
      .fn<JobDeps["sendCalendarNotice"]>()
      .mockResolvedValue({ sent: 1, failed: 0 }),
    sendNotificationEmails: vi.fn<JobDeps["sendNotificationEmails"]>(),
    sendNotificationDigests: vi.fn<JobDeps["sendNotificationDigests"]>(),
    sendWeeklyDigests: vi.fn<JobDeps["sendWeeklyDigests"]>(),
    purgeDueAccounts: vi.fn<JobDeps["purgeDueAccounts"]>(),
    runMigration: vi.fn<JobDeps["runMigration"]>(),
    generateInvoices: vi.fn<JobDeps["generateInvoices"]>(),
    reconcileBilling: vi.fn<JobDeps["reconcileBilling"]>(),
    backfillLastSeen: vi.fn<JobDeps["backfillLastSeen"]>(),
    webhooks: {
      fanout: vi.fn<JobDeps["webhooks"]["fanout"]>(),
      deliver: vi.fn<JobDeps["webhooks"]["deliver"]>(),
      sweep: vi.fn<JobDeps["webhooks"]["sweep"]>(),
    },
    expireComps: vi.fn<JobDeps["expireComps"]>(),
    sweepSubscriberMoves: vi.fn<JobDeps["sweepSubscriberMoves"]>(),
    expireHolds: vi.fn<JobDeps["expireHolds"]>(),
    queueRenewalReminders: vi.fn<JobDeps["queueRenewalReminders"]>(),
    prepareRenewalReminder: vi.fn<JobDeps["prepareRenewalReminder"]>(),
    sendRenewalEmail: vi.fn<JobDeps["sendRenewalEmail"]>(),
    appUrl: "https://cohory.test",
    endClosedBillingAccess: vi.fn<JobDeps["endClosedBillingAccess"]>(),
    expireApprovals: vi.fn<JobDeps["expireApprovals"]>(),
    sweepDelegations: vi.fn<JobDeps["sweepDelegations"]>(),
    noticeExpiringTokens: vi.fn<JobDeps["noticeExpiringTokens"]>(),
    pruneOAuthClients: vi.fn<JobDeps["pruneOAuthClients"]>(),
    reencryptSecrets: vi.fn<JobDeps["reencryptSecrets"]>(),
    collectAgentFileGarbage: vi.fn<JobDeps["collectAgentFileGarbage"]>(),
    expireMigrationFiles: vi.fn<JobDeps["expireMigrationFiles"]>(),
    sendQueuedEmail: vi.fn<JobDeps["sendQueuedEmail"]>(),
    inviteCreator: vi.fn<JobDeps["inviteCreator"]>(),
    scheduledPosts: {
      publishDue: vi
        .fn<JobDeps["scheduledPosts"]["publishDue"]>()
        .mockResolvedValue({ published: [], discarded: 0, errors: [] }),
      relay: vi.fn<JobDeps["scheduledPosts"]["relay"]>(),
    },
    outbox: {
      relay: vi.fn().mockResolvedValue({ published: 0, failed: 0, errors: [] }),
      prune: vi.fn().mockResolvedValue(0),
      now: () => new Date("2026-10-18T10:00:00Z"),
    },
  };
}

describe("calendar jobs", () => {
  it("schedules reminders every five minutes and the series top up weekly", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger, deps());

    expect(createQueue).toHaveBeenCalledWith(CALENDAR_REMINDERS, { policy: "stately" });
    expect(createQueue).toHaveBeenCalledWith(CALENDAR_EXTEND, { policy: "stately" });
    expect(work).toHaveBeenCalledWith(CALENDAR_REMINDERS, expect.any(Function));
    expect(work).toHaveBeenCalledWith(CALENDAR_EXTEND, expect.any(Function));
    expect(schedule).toHaveBeenCalledWith("calendar.reminders", "*/5 * * * *");
    expect(schedule).toHaveBeenCalledWith("calendar.extend", "0 3 * * 1");
    expect(createQueue).toHaveBeenCalledWith(CALENDAR_TIME_CHANGE, timeChangeQueueOptions);
    expect(work).toHaveBeenCalledWith(CALENDAR_TIME_CHANGE, expect.any(Function));
    expect(createQueue).toHaveBeenCalledWith(CALENDAR_NOTICE, noticeQueueOptions);
    expect(work).toHaveBeenCalledWith(CALENDAR_NOTICE, expect.any(Function));
  });

  it("parses a calendar notice job and rejects a malformed one", async () => {
    const jobDeps = deps();
    const data = {
      kind: "rsvp_going",
      communityId: "0192f0a0-0000-7000-8000-00000000c001",
      occurrenceId: "0192f0a0-0000-7000-8000-00000000a001",
      userId: "0192f0a0-0000-7000-8000-00000000b001",
    };
    const handle = createCalendarNoticeHandler(silentLogger, jobDeps.sendCalendarNotice);

    await handle([fakeJob(CALENDAR_NOTICE, data)]);
    await expect(handle([fakeJob(CALENDAR_NOTICE, { kind: "rsvp_going" })])).rejects.toThrow();

    expect(jobDeps.sendCalendarNotice).toHaveBeenCalledTimes(1);
    expect(jobDeps.sendCalendarNotice).toHaveBeenCalledWith(data);
  });

  it("parses a time change job and emails the new time once per job", async () => {
    const jobDeps = deps();
    const data = {
      communityId: "0192f0a0-0000-7000-8000-00000000c001",
      eventId: "0192f0a0-0000-7000-8000-00000000e001",
      editorId: null,
      changedAt: "2026-10-18T10:00:00.000Z",
      previousZone: "Europe/Berlin",
      baseline: [
        {
          occurrenceId: "0192f0a0-0000-7000-8000-00000000a001",
          previousStart: "2026-10-18T16:00:00.000Z",
        },
      ],
      removals: [],
    };

    await createCalendarTimeChangeHandler(
      silentLogger,
      jobDeps.notifyTimeChange,
    )([fakeJob(CALENDAR_TIME_CHANGE, data)]);

    expect(jobDeps.notifyTimeChange).toHaveBeenCalledWith({
      ...data,
      changedAt: new Date("2026-10-18T10:00:00.000Z"),
      baseline: [{ ...data.baseline[0], previousStart: new Date("2026-10-18T16:00:00.000Z") }],
    });
  });

  it("rejects a malformed time change job without emailing anyone", async () => {
    const jobDeps = deps();

    await expect(
      createCalendarTimeChangeHandler(
        silentLogger,
        jobDeps.notifyTimeChange,
      )([fakeJob(CALENDAR_TIME_CHANGE, { communityId: "nope" })]),
    ).rejects.toThrow();
    expect(jobDeps.notifyTimeChange).not.toHaveBeenCalled();
  });

  it("runs one reminder pass and one top up per job", async () => {
    const jobDeps = deps();

    await createCalendarRemindersHandler(
      silentLogger,
      jobDeps.sendDueReminders,
    )([fakeJob(CALENDAR_REMINDERS)]);
    await createCalendarExtendHandler(
      silentLogger,
      jobDeps.extendSeries,
    )([fakeJob(CALENDAR_EXTEND)]);

    expect(jobDeps.sendDueReminders).toHaveBeenCalledTimes(1);
    expect(jobDeps.extendSeries).toHaveBeenCalledTimes(1);
  });

  it("lets a failed pass reject so pg-boss records the failure", async () => {
    const run = vi.fn<JobDeps["sendDueReminders"]>().mockRejectedValue(new Error("db down"));

    await expect(
      createCalendarRemindersHandler(silentLogger, run)([fakeJob(CALENDAR_REMINDERS)]),
    ).rejects.toThrow("db down");
  });
});
