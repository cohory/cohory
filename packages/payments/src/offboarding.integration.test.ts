import { ForbiddenError } from "@cohory/authz";
import { getCommunityById, type CommunityId, type Database } from "@cohory/db";
import { outbox, paymentConnections, paymentExitRuns, subscriptions } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExitInProgressError, NotConnectedError, PaymentsValidationError } from "./errors";
import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { ExitRunJobPayload, PaymentsJobs } from "./jobs";
import type { SubscriptionRecord } from "./repository";
import {
  communityEnv,
  cloudEnv,
  insertCommunity,
  insertMember,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
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
    scheduleFeeRemoval: async () => {
      throw new Error("disconnect must not schedule the old fee removal job");
    },
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
  input: MirroredSubscriptionInput = {},
): Promise<SubscriptionRecord> {
  const row = await mirrorSubscription(admin.db, paid.communityId, input);
  harness.gateway.subscriptions.set(row.externalSubscriptionId, {
    id: row.externalSubscriptionId,
    status: row.providerStatus,
    customerId: `cus_${row.id}`,
    metadata: {},
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    endedAt: null,
    interval: "month",
    applicationFeePercent: row.applicationFeeBps > 0 ? row.applicationFeeBps / 100 : null,
    priceId: null,
  });
  return row;
}

async function connectionOf(communityId: CommunityId) {
  const [row] = await admin.db
    .select()
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, communityId));
  return row ?? null;
}

async function noticesOf(communityId: CommunityId): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, paidMembershipEventsTopic)));
  return rows.flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events);
}

function changed(events: readonly PaidMembershipEvent[], change: string) {
  return events.flatMap((event) =>
    event.type === "paid_membership.changed" && event.payload.change === change
      ? [event.payload]
      : [],
  );
}

function feeClearNotices(events: readonly PaidMembershipEvent[]) {
  return events.filter((event) => event.type === "payments.fee_clear_required");
}

const stripeDown = () =>
  Object.assign(new Error("boom"), { type: "StripeAPIError", code: "api_error" });

describe("disconnecting as an exit run", () => {
  it("removes every fee and verifies it before the connection closes", async () => {
    const { harness, paid } = await paidSetup();
    const first = await paying(harness, paid);
    const second = await paying(harness, paid, { providerStatus: "past_due" });
    const seen: string[] = [];
    const clear = harness.gateway.clearSubscriptionApplicationFee.bind(harness.gateway);
    harness.gateway.clearSubscriptionApplicationFee = async (account, id, key) => {
      seen.push((await connectionOf(paid.communityId))?.status ?? "missing");
      return clear(account, id, key);
    };

    const view = await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId, {
      portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
    });

    expect(seen).toEqual(["disconnecting", "disconnecting"]);
    expect(view.status).toBe("disconnected");
    const connection = await connectionOf(paid.communityId);
    expect(connection).toMatchObject({ status: "disconnected" });
    expect(connection?.disconnectedAt).not.toBeNull();
    const keys = harness.gateway
      .writes("clearSubscriptionApplicationFee")
      .map((call) => call.idempotencyKey)
      .sort();
    expect(keys).toEqual(
      [first, second]
        .map((sub) => `disconnect:${connection?.id}:${sub.externalSubscriptionId}`)
        .sort(),
    );
    for (const sub of [first, second]) {
      expect(
        harness.gateway.subscriptions.get(sub.externalSubscriptionId)?.applicationFeePercent,
      ).toBeNull();
    }
    const fees = await admin.db
      .select({ bps: subscriptions.applicationFeeBps })
      .from(subscriptions)
      .where(eq(subscriptions.communityId, paid.communityId));
    expect(fees.map((row) => row.bps)).toEqual([0, 0]);
    expect(await harness.service.getPlan(user(paid.ownerId), paid.communityId)).toBeNull();
    expect((await getCommunityById(admin.db, paid.communityId))?.currency).toBeNull();
    expect(harness.gateway.writes("scheduleCancellation")).toEqual([]);

    const [notice] = changed(await noticesOf(paid.communityId), "billed_by_creator");
    expect(notice?.recipients.map((r) => r.userId).sort()).toEqual(
      [first.userId, second.userId].sort(),
    );
    expect(notice?.portalLoginUrl).toBe("https://billing.stripe.com/p/login/test_abc");
    expect(notice?.supportContact).toMatch(/@example\.test$/);
    expect(feeClearNotices(await noticesOf(paid.communityId))).toEqual([]);
  });

  it("winds down by setting cancel_at_period_end after the fee is gone", async () => {
    const { harness, paid } = await paidSetup();
    const sub = await paying(harness, paid);
    const order: string[] = [];
    const clear = harness.gateway.clearSubscriptionApplicationFee.bind(harness.gateway);
    const schedule = harness.gateway.scheduleCancellation.bind(harness.gateway);
    harness.gateway.clearSubscriptionApplicationFee = async (account, id, key) => {
      order.push("remove_fee");
      return clear(account, id, key);
    };
    harness.gateway.scheduleCancellation = async (account, id, key) => {
      order.push("cancel_at_period_end");
      return schedule(account, id, key);
    };

    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId, {
      memberChoice: "wind_down",
    });

    expect(order).toEqual(["remove_fee", "cancel_at_period_end"]);
    const [run] = await admin.db
      .select()
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.communityId, paid.communityId));
    expect(run).toMatchObject({ kind: "disconnect", choice: "wind_down", status: "done" });
    expect(harness.gateway.writes("scheduleCancellation")[0]?.idempotencyKey).toBe(
      `exit:${run?.id}:${sub.id}:period-end`,
    );
    expect((await connectionOf(paid.communityId))?.status).toBe("disconnected");
    const [notice] = changed(await noticesOf(paid.communityId), "winding_down");
    expect(notice?.recipients).toEqual([
      { userId: sub.userId, endsAt: "2026-11-18T10:00:00.000Z" },
    ]);
  });

  it("keeps the connection disconnecting and checkouts closed while a fee cannot be removed", async () => {
    const jobs = queue();
    const { harness, paid } = await paidSetup(jobs);
    const stuck = await paying(harness, paid);
    harness.gateway.failOn(
      "clearSubscriptionApplicationFee",
      stuck.externalSubscriptionId,
      stripeDown(),
      20,
    );

    const view = await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);

    expect(view.status).toBe("disconnecting");
    expect(jobs.scheduled).toHaveLength(1);
    await expect(
      harness.service.runExitRun(jobs.scheduled[0] ?? { runId: "", communityId: "" }),
    ).rejects.toMatchObject({
      name: "ExitRunIncompleteError",
    });
    expect((await connectionOf(paid.communityId))?.status).toBe("disconnecting");
    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toBeInstanceOf(NotConnectedError);
    expect((await harness.service.getPlan(user(paid.ownerId), paid.communityId))?.purchasable).toBe(
      false,
    );
    await expect(
      harness.service.disconnectStripe(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(ExitInProgressError);
    const summary = await harness.service.getPaidMembersSummary(
      user(paid.ownerId),
      paid.communityId,
    );
    expect(summary.connection).toBe("disconnecting");
    expect(summary.run).toMatchObject({ kind: "disconnect", status: "running", failedCount: 1 });
  });

  it("lets the owner disconnect anyway after the run failed and tells them to clear the fee", async () => {
    const { harness, paid } = await paidSetup();
    const fine = await paying(harness, paid);
    const stuck = await paying(harness, paid);
    harness.gateway.failOn(
      "clearSubscriptionApplicationFee",
      stuck.externalSubscriptionId,
      stripeDown(),
      8,
    );

    const view = await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    expect(view.status).toBe("disconnecting");
    const summary = await harness.service.getPaidMembersSummary(
      user(paid.ownerId),
      paid.communityId,
    );
    expect(summary.run).toMatchObject({ status: "failed", failedCount: 1 });
    expect(summary.run?.failedMembers.map((member) => member.userId)).toEqual([stuck.userId]);
    expect(await noticesOf(paid.communityId)).toEqual([]);

    await expect(
      harness.service.forceDisconnect(user(paid.adminId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const closed = await harness.service.forceDisconnect(user(paid.ownerId), paid.communityId);

    expect(closed.status).toBe("disconnected");
    const [run] = await admin.db
      .select()
      .from(paymentExitRuns)
      .where(eq(paymentExitRuns.communityId, paid.communityId));
    expect(run).toMatchObject({ status: "failed", failedSubscriptionIds: [stuck.id] });
    const events = await noticesOf(paid.communityId);
    expect(
      changed(events, "billed_by_creator")
        .flatMap((notice) => notice.recipients.map((r) => r.userId))
        .sort(),
    ).toEqual([fine.userId, stuck.userId].sort());
    expect(feeClearNotices(events)).toHaveLength(1);
    expect(feeClearNotices(events)[0]?.payload).toMatchObject({ ownerId: paid.ownerId });
    await expect(
      harness.service.forceDisconnect(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("refuses disconnect anyway while the run is still retrying", async () => {
    const jobs = queue();
    const { harness, paid } = await paidSetup(jobs);
    const stuck = await paying(harness, paid);
    harness.gateway.failOn(
      "clearSubscriptionApplicationFee",
      stuck.externalSubscriptionId,
      stripeDown(),
    );
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);

    await expect(
      harness.service.forceDisconnect(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(ExitInProgressError);
    expect((await connectionOf(paid.communityId))?.status).toBe("disconnecting");
  });

  it("lets the owner retry a failed disconnect and closes the connection when it succeeds", async () => {
    const { harness, paid } = await paidSetup();
    const stuck = await paying(harness, paid);
    harness.gateway.failOn(
      "clearSubscriptionApplicationFee",
      stuck.externalSubscriptionId,
      stripeDown(),
      8,
    );
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);

    const retried = await harness.service.retryExitRun(user(paid.ownerId), paid.communityId);

    expect(retried).toMatchObject({ kind: "disconnect", status: "done" });
    expect((await connectionOf(paid.communityId))?.status).toBe("disconnected");
  });

  it("refuses disconnect for an admin", async () => {
    const { harness, paid } = await paidSetup();
    await paying(harness, paid);

    await expect(
      harness.service.disconnectStripe(user(paid.adminId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await connectionOf(paid.communityId))?.status).toBe("active");
    expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
  });

  it("needs an open connection and refuses a portal link that is not Stripe's", async () => {
    const { harness, paid } = await paidSetup();

    await expect(
      harness.service.disconnectStripe(user(paid.ownerId), paid.communityId, {
        portalLoginUrl: "https://billing.stripe.com.evil.test/p/login/x",
      }),
    ).rejects.toBeInstanceOf(PaymentsValidationError);
    await harness.service.disconnectStripe(user(paid.ownerId), paid.communityId);
    await expect(
      harness.service.disconnectStripe(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("refuses to disconnect while another change to paid members runs", async () => {
    const jobs = queue();
    const { harness, paid } = await paidSetup(jobs);
    await paying(harness, paid);
    await harness.service.beginArchive({
      communityId: paid.communityId,
      actorId: paid.ownerId,
      choice: "stop_at_period_end",
      includeLinked: true,
    });

    await expect(
      harness.service.disconnectStripe(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(ExitInProgressError);
    expect((await connectionOf(paid.communityId))?.status).toBe("active");
  });

  it("disconnects own keys connections without a fee step", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "sk_test_owner",
      webhookSecret: "whsec_owner",
    });
    const sub = await mirrorSubscription(admin.db, communityId, { applicationFeeBps: 0 });

    const view = await harness.service.disconnectStripe(user(ownerId), communityId);

    expect(view.status).toBe("disconnected");
    expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
    expect(harness.gateway.writes("setSubscriptionApplicationFee")).toEqual([]);
    const [notice] = changed(await noticesOf(communityId), "billed_by_creator");
    expect(notice?.recipients.map((r) => r.userId)).toEqual([sub.userId]);
  });
});

describe("fee removal jobs queued before the upgrade", () => {
  it("still clears the fee on a closed connection", async () => {
    const { harness, paid } = await paidSetup();
    const sub = await paying(harness, paid);
    const connection = await connectionOf(paid.communityId);
    await admin.db
      .update(paymentConnections)
      .set({ status: "disconnected", disconnectedAt: new Date() })
      .where(eq(paymentConnections.id, connection?.id ?? ""));

    const result = await harness.service.removeApplicationFees(connection?.id ?? "");

    expect(result).toEqual({ cleared: 1, remaining: 0 });
    expect(
      harness.gateway.subscriptions.get(sub.externalSubscriptionId)?.applicationFeePercent,
    ).toBeNull();
  });

  it("leaves subscriptions alone on a provider that does not split fees", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    const view = await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "sk_test_owner",
      webhookSecret: "whsec_owner",
    });
    await mirrorSubscription(admin.db, communityId, { applicationFeeBps: 200 });

    const result = await harness.service.removeApplicationFees(view.id);

    expect(result).toEqual({ cleared: 0, remaining: 0 });
    expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
  });
});
