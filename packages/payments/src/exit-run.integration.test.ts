import type { CommunityId, Database } from "@cohory/db";
import { outbox, paymentExitRuns, subscriptions } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExitInProgressError } from "./errors";
import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { ExitRunJobPayload, PaymentsJobs } from "./jobs";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import type { SubscriptionRecord } from "./repository";
import { cloudEnv, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type Harness,
  type MirroredSubscriptionInput,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

function queue(): PaymentsJobs & { readonly scheduled: ExitRunJobPayload[] } {
  const scheduled: ExitRunJobPayload[] = [];
  return {
    scheduled,
    scheduleFeeRemoval: async () => {},
    scheduleExitRun: async (payload) => {
      scheduled.push(payload);
    },
    scheduleMemberBillingEnd: async () => {},
    scheduleWebhookEvent: async () => {},
    scheduleBillingWebhookEvent: async () => {},
    scheduleConnectionReconcile: async () => {},
    scheduleRenewalReminder: async () => {},
  };
}

async function paidSetup(jobs: PaymentsJobs | null = null) {
  const harness = createHarness(probe.db, cloudEnv(), jobs);
  const paid = await setupPaidCommunity(admin.db, harness);
  return { harness, paid };
}

async function paying(
  harness: Harness,
  paid: PaidCommunity,
  input: MirroredSubscriptionInput & { stripeStatus?: string } = {},
): Promise<SubscriptionRecord> {
  const row = await mirrorSubscription(admin.db, paid.communityId, input);
  harness.gateway.subscriptions.set(row.externalSubscriptionId, {
    id: row.externalSubscriptionId,
    status: input.stripeStatus ?? row.providerStatus,
    customerId: `cus_${row.id}`,
    metadata: {},
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    endedAt: null,
    interval: "month",
    applicationFeePercent: 2,
    priceId: null,
  });
  return row;
}

async function noticesOf(communityId: CommunityId): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, paidMembershipEventsTopic)));
  return rows.flatMap((row) => {
    const payload = row.payload as { events: PaidMembershipEvent[] };
    return payload.events;
  });
}

function recipientsOf(events: readonly PaidMembershipEvent[], change: string) {
  return events.flatMap((event) =>
    event.type === "paid_membership.changed" && event.payload.change === change
      ? event.payload.recipients
      : [],
  );
}

function archive(harness: Harness, paid: PaidCommunity, choice = "stop_at_period_end" as const) {
  return harness.service.beginArchive({
    communityId: paid.communityId,
    actorId: paid.ownerId,
    choice,
    includeLinked: true,
  });
}

describe("exit run engine", () => {
  it("sets cancel_at_period_end on every eligible subscription with one key per subscription", async () => {
    const { harness, paid } = await paidSetup();
    const first = await paying(harness, paid);
    const second = await paying(harness, paid, { providerStatus: "past_due" });
    await paying(harness, paid, { providerStatus: "canceled" });

    const run = await archive(harness, paid);

    expect(run).toMatchObject({ kind: "archive", status: "done", targetCount: 2, doneCount: 2 });
    const writes = harness.gateway.writes("scheduleCancellation");
    expect(writes.map((call) => call.idempotencyKey).sort()).toEqual(
      [`exit:${run?.id}:${first.id}:period-end`, `exit:${run?.id}:${second.id}:period-end`].sort(),
    );
    expect(writes.every((call) => call.account === paid.accountId)).toBe(true);
    const mirrored = await admin.db
      .select({ id: subscriptions.id, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions)
      .where(eq(subscriptions.communityId, paid.communityId));
    expect(
      mirrored
        .filter((row) => row.cancelAtPeriodEnd)
        .map((row) => row.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    const ending = recipientsOf(await noticesOf(paid.communityId), "archived_ending");
    expect(ending.map((recipient) => recipient.userId).sort()).toEqual(
      [first.userId, second.userId].sort(),
    );
    expect(ending[0]?.endsAt).toBe("2026-11-18T10:00:00.000Z");
  });

  it("skips a subscription the member already canceled in Stripe and still finishes", async () => {
    const { harness, paid } = await paidSetup();
    const stays = await paying(harness, paid);
    const left = await paying(harness, paid, { stripeStatus: "canceled" });

    const run = await archive(harness, paid);

    expect(run).toMatchObject({ status: "done", failedCount: 0 });
    const keys = harness.gateway.writes("scheduleCancellation").map((call) => call.idempotencyKey);
    expect(keys).toEqual([`exit:${run?.id}:${stays.id}:period-end`]);
    const ending = recipientsOf(await noticesOf(paid.communityId), "archived_ending");
    expect(ending.map((recipient) => recipient.userId)).toEqual([stays.userId]);
    expect(ending.map((recipient) => recipient.userId)).not.toContain(left.userId);
  });

  it("does not write again for a subscription already set to end", async () => {
    const { harness, paid } = await paidSetup();
    const already = await paying(harness, paid);
    const current = harness.gateway.subscriptions.get(already.externalSubscriptionId);
    if (current) {
      harness.gateway.subscriptions.set(already.externalSubscriptionId, {
        ...current,
        cancelAtPeriodEnd: true,
      });
    }

    const run = await archive(harness, paid);

    expect(run).toMatchObject({ status: "done", doneCount: 1 });
    expect(harness.gateway.writes("scheduleCancellation")).toEqual([]);
  });

  it("leaves linked imports running when the owner chose to", async () => {
    const { harness, paid } = await paidSetup();
    const cohory = await paying(harness, paid);
    const linked = await paying(harness, paid, { origin: "linked_import" });

    const run = await harness.service.beginArchive({
      communityId: paid.communityId,
      actorId: paid.ownerId,
      choice: "stop_at_period_end",
      includeLinked: false,
    });

    expect(run).toMatchObject({ status: "done", targetCount: 1, doneCount: 1 });
    const subjects = harness.gateway
      .writes("scheduleCancellation")
      .map((call) => (call.input as { subscriptionId: string }).subscriptionId);
    expect(subjects).toEqual([cohory.externalSubscriptionId]);
    const events = await noticesOf(paid.communityId);
    expect(recipientsOf(events, "archived_ending").map((r) => r.userId)).toEqual([cohory.userId]);
    expect(recipientsOf(events, "archived_continuing").map((r) => r.userId)).toEqual([
      linked.userId,
    ]);
  });

  it("retries a failing subscription and fails the run on the eighth attempt", async () => {
    const { harness, paid } = await paidSetup();
    const fine = await paying(harness, paid);
    const stuck = await paying(harness, paid);
    harness.gateway.failOn(
      "scheduleCancellation",
      stuck.externalSubscriptionId,
      Object.assign(new Error("boom"), { type: "StripeAPIError", code: "api_error" }),
    );

    const run = await archive(harness, paid);

    expect(run).toMatchObject({ status: "failed", failedCount: 1, doneCount: 1 });
    expect(run?.failedMembers.map((member) => member.userId)).toEqual([stuck.userId]);
    const [row] = await admin.db
      .select()
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.id, run?.id ?? ""));
    expect(row).toMatchObject({ attempts: 8, failedSubscriptionIds: [stuck.id] });
    expect(
      harness.gateway
        .writes("scheduleCancellation")
        .filter((call) => call.idempotencyKey?.includes(stuck.id)),
    ).toHaveLength(8);
    const ending = recipientsOf(await noticesOf(paid.communityId), "archived_ending");
    expect(ending.map((recipient) => recipient.userId)).toEqual([fine.userId]);
  });

  it("lets the owner retry a failed run and finishes it", async () => {
    const { harness, paid } = await paidSetup();
    const stuck = await paying(harness, paid);
    harness.gateway.failOn("scheduleCancellation", stuck.externalSubscriptionId, new Error("x"), 8);
    expect(await archive(harness, paid)).toMatchObject({ status: "failed" });

    await expect(
      harness.service.retryExitRun(user(paid.adminId), paid.communityId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    const retried = await harness.service.retryExitRun(user(paid.ownerId), paid.communityId);

    expect(retried).toMatchObject({ status: "done", failedCount: 0, doneCount: 1 });
  });

  it("does not write to Stripe again when a done run is replayed", async () => {
    const { harness, paid } = await paidSetup();
    await paying(harness, paid);
    const run = await archive(harness, paid);
    const before = harness.gateway.calls.length;

    const replay = await harness.service.runExitRun({
      runId: run?.id ?? "",
      communityId: paid.communityId,
    });

    expect(replay).toMatchObject({ status: "done", kind: "archive" });
    expect(harness.gateway.calls.length).toBe(before);
  });

  it("refuses a second run while one is unfinished", async () => {
    const jobs = queue();
    const { harness, paid } = await paidSetup(jobs);
    await paying(harness, paid);

    const first = await archive(harness, paid);
    const second = archive(harness, paid);

    expect(first?.status).toBe("pending");
    await expect(second).rejects.toBeInstanceOf(ExitInProgressError);
    expect(jobs.scheduled).toHaveLength(1);
    expect(harness.gateway.writes("scheduleCancellation")).toEqual([]);
  });

  it("schedules the job after commit and runs inline without a queue", async () => {
    const jobs = queue();
    const queued = await paidSetup(jobs);
    await paying(queued.harness, queued.paid);
    const run = await archive(queued.harness, queued.paid);

    expect(jobs.scheduled).toEqual([{ runId: run?.id, communityId: queued.paid.communityId }]);
    const [stored] = await admin.db
      .select({ status: paymentExitRuns.status })
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.id, run?.id ?? ""));
    expect(stored?.status).toBe("pending");
    const result = await queued.harness.service.runExitRun(
      jobs.scheduled[0] ?? {
        runId: "",
        communityId: "",
      },
    );
    expect(result.status).toBe("done");

    const inline = await paidSetup(null);
    await paying(inline.harness, inline.paid);
    expect(await archive(inline.harness, inline.paid)).toMatchObject({ status: "done" });
  });

  it("counts paid members for an admin and refuses a plain member", async () => {
    const { harness, paid } = await paidSetup();
    await paying(harness, paid);
    await paying(harness, paid, { origin: "linked_import" });
    await paying(harness, paid, { cancelAtPeriodEnd: true });

    const summary = await harness.service.getPaidMembersSummary(
      user(paid.adminId),
      paid.communityId,
    );

    expect(summary).toEqual({
      connection: "open",
      cohory: 2,
      linkedImports: 1,
      endingAtPeriodEnd: 1,
      manualCancellation: 0,
      run: null,
    });
    await expect(
      harness.service.getPaidMembersSummary(user(paid.memberId), paid.communityId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("writes notices for a deleted community without a community id", async () => {
    const { paid } = await paidSetup();
    const repo = createPostgresPaymentsRepository(probe.db);
    const event: PaidMembershipEvent = {
      type: "payments.fee_clear_required",
      payload: {
        noticeId: crypto.randomUUID(),
        communityId: paid.communityId,
        communitySlug: "s",
        communityName: "n",
        ownerId: paid.ownerId,
      },
    };
    await repo.inCommunityAsSystem(paid.communityId, (store) =>
      store.exit.appendNotices([event], "detached"),
    );

    const rows = await admin.db
      .select({ communityId: outbox.communityId, payload: outbox.payload })
      .from(outbox)
      .where(eq(outbox.topic, paidMembershipEventsTopic));
    const ours = rows.filter((row) => JSON.stringify(row.payload).includes(event.payload.noticeId));
    expect(ours).toEqual([{ communityId: null, payload: { events: [event] } }]);
  });
});
