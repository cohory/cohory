import { ForbiddenError } from "@cohory/authz";
import {
  leaveMembership,
  setMemberRemovalReason,
  withCommunity,
  type CommunityId,
  type Database,
} from "@cohory/db";
import { memberships, subscriptions } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PaymentsNotFoundError } from "./errors";
import type { MemberBillingEndJobPayload, PaymentsJobs } from "./jobs";
import { cloudEnv, insertMember, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  stripeSubscription,
  type Harness,
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

interface Setup {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly payerId: string;
  readonly subscriptionId: string;
  readonly externalId: string;
}

async function payingMember(
  overrides: { interval?: "month" | "year"; planId?: string | null; jobs?: PaymentsJobs } = {},
): Promise<Setup> {
  const harness = createHarness(probe.db, cloudEnv(), overrides.jobs ?? null);
  const paid = await setupPaidCommunity(admin.db, harness);
  const payerId = await insertMember(admin.db, paid.communityId, "member");
  const mirrored = await mirrorSubscription(admin.db, paid.communityId, {
    userId: payerId,
    planId: overrides.planId === undefined ? paid.planId : overrides.planId,
  });
  if (overrides.interval) {
    await admin.db
      .update(subscriptions)
      .set({ interval: overrides.interval })
      .where(eq(subscriptions.id, mirrored.id));
  }
  harness.gateway.subscriptions.set(
    mirrored.externalSubscriptionId,
    stripeSubscription(paid, payerId, { id: mirrored.externalSubscriptionId }),
  );
  return {
    harness,
    paid,
    payerId,
    subscriptionId: mirrored.id,
    externalId: mirrored.externalSubscriptionId,
  };
}

async function setMembership(
  communityId: CommunityId,
  userId: string,
  status: "removed" | "banned",
): Promise<void> {
  await admin.db.transaction(async (tx) => {
    if (status === "removed") {
      await setMemberRemovalReason(tx, "removed");
    }
    await tx
      .update(memberships)
      .set({ status })
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)));
  });
}

async function accessStateOf(subscriptionId: string): Promise<string | undefined> {
  const [row] = await admin.db
    .select({ accessState: subscriptions.accessState })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId));
  return row?.accessState;
}

describe("ending billing when staff remove or ban a member", () => {
  it.each(["removed", "banned"] as const)(
    "cancels the subscription now without proration or refund when the member is %s",
    async (kind) => {
      const setup = await payingMember();
      await setMembership(setup.paid.communityId, setup.payerId, kind);

      const result = await setup.harness.service.endBillingForRemovedMember({
        communityId: setup.paid.communityId,
        userId: setup.payerId,
        kind,
      });

      expect(result).toEqual({ canceled: 1 });
      const cancels = setup.harness.gateway.writes("cancelSubscription");
      expect(cancels).toHaveLength(1);
      expect(cancels[0]?.account).toBe(setup.paid.accountId);
      expect(cancels[0]?.idempotencyKey).toBe(`staff-removal:${setup.subscriptionId}`);
      expect(setup.harness.gateway.writes("scheduleCancellation")).toEqual([]);
      expect(setup.harness.gateway.writes("createRefund")).toEqual([]);
      expect(setup.harness.gateway.subscriptions.get(setup.externalId)?.status).toBe("canceled");
      expect(await accessStateOf(setup.subscriptionId)).toBe("revoked");
    },
  );

  it("cancels only once when the same removal is delivered twice", async () => {
    const setup = await payingMember();
    await setMembership(setup.paid.communityId, setup.payerId, "banned");
    const event = {
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "banned",
    } as const;

    await setup.harness.service.endBillingForRemovedMember(event);
    const again = await setup.harness.service.endBillingForRemovedMember(event);

    expect(again).toEqual({ canceled: 0 });
    expect(setup.harness.gateway.writes("cancelSubscription")).toHaveLength(1);
  });

  it("leaves the subscription alone when the member left on their own", async () => {
    const setup = await payingMember();
    await leaveMembership(withCommunity(admin.db, setup.paid.communityId), setup.payerId);

    const result = await setup.harness.service.endBillingForRemovedMember({
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "removed",
    });

    expect(result).toEqual({ canceled: 0 });
    expect(setup.harness.gateway.writes("cancelSubscription")).toEqual([]);
    expect(await accessStateOf(setup.subscriptionId)).toBe("granted");
  });

  it("leaves the subscription alone when the member is active again", async () => {
    const setup = await payingMember();

    const result = await setup.harness.service.endBillingForRemovedMember({
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "removed",
    });

    expect(result).toEqual({ canceled: 0 });
    expect(setup.harness.gateway.writes("cancelSubscription")).toEqual([]);
  });

  it("does nothing for a removed member without a subscription", async () => {
    const setup = await payingMember();
    const otherId = await insertMember(admin.db, setup.paid.communityId, "member");
    await setMembership(setup.paid.communityId, otherId, "removed");

    const result = await setup.harness.service.endBillingForRemovedMember({
      communityId: setup.paid.communityId,
      userId: otherId,
      kind: "removed",
    });

    expect(result).toEqual({ canceled: 0 });
    expect(setup.harness.gateway.writes("cancelSubscription")).toEqual([]);
  });
});

function queue(fail = false): PaymentsJobs & { readonly scheduled: MemberBillingEndJobPayload[] } {
  const scheduled: MemberBillingEndJobPayload[] = [];
  return {
    scheduled,
    scheduleFeeRemoval: async () => {},
    scheduleExitRun: async () => {},
    scheduleMemberBillingEnd: async (payload) => {
      if (fail) {
        throw new Error("queue is down");
      }
      scheduled.push(payload);
    },
    scheduleWebhookEvent: async () => {},
    scheduleBillingWebhookEvent: async () => {},
    scheduleConnectionReconcile: async () => {},
    scheduleRenewalReminder: async () => {},
  };
}

describe("requestBillingEndForRemovedMember", () => {
  it("queues a retried job instead of calling Stripe in the request", async () => {
    const jobs = queue();
    const setup = await payingMember({ jobs });
    await setMembership(setup.paid.communityId, setup.payerId, "removed");
    const event = {
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "removed",
    } as const;

    await setup.harness.service.requestBillingEndForRemovedMember(event);

    expect(jobs.scheduled).toEqual([event]);
    expect(setup.harness.gateway.writes("cancelSubscription")).toEqual([]);
  });

  it("ends billing in the request when the job cannot be queued", async () => {
    const setup = await payingMember({ jobs: queue(true) });
    await setMembership(setup.paid.communityId, setup.payerId, "banned");

    await setup.harness.service.requestBillingEndForRemovedMember({
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "banned",
    });

    expect(setup.harness.gateway.writes("cancelSubscription")).toHaveLength(1);
  });

  it("ends billing in the request when no queue is configured", async () => {
    const setup = await payingMember();
    await setMembership(setup.paid.communityId, setup.payerId, "removed");

    await setup.harness.service.requestBillingEndForRemovedMember({
      communityId: setup.paid.communityId,
      userId: setup.payerId,
      kind: "removed",
    });

    expect(setup.harness.gateway.writes("cancelSubscription")).toHaveLength(1);
  });
});

describe("getMemberBilling", () => {
  it("shows staff what a paying member pays per month", async () => {
    const setup = await payingMember();

    for (const staffId of [setup.paid.ownerId, setup.paid.adminId]) {
      expect(
        await setup.harness.service.getMemberBilling(
          user(staffId),
          setup.paid.communityId,
          setup.payerId,
        ),
      ).toEqual({ paying: true, amountMinor: 4900, currency: "usd", interval: "month" });
    }
  });

  it("shows the annual price for a yearly subscription", async () => {
    const setup = await payingMember({ interval: "year" });

    expect(
      await setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        setup.paid.communityId,
        setup.payerId,
      ),
    ).toEqual({ paying: true, amountMinor: 49_000, currency: "usd", interval: "year" });
  });

  it("shows a moderator that the member pays", async () => {
    const setup = await payingMember();
    const moderatorId = await insertMember(admin.db, setup.paid.communityId, "moderator");

    expect(
      await setup.harness.service.getMemberBilling(
        user(moderatorId),
        setup.paid.communityId,
        setup.payerId,
      ),
    ).toMatchObject({ paying: true });
  });

  it("leaves the amount out when the subscription has no known plan", async () => {
    const setup = await payingMember({ planId: null });

    expect(
      await setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        setup.paid.communityId,
        setup.payerId,
      ),
    ).toEqual({ paying: true, amountMinor: null, currency: null, interval: "month" });
  });

  it("answers not paying for a member without a subscription", async () => {
    const setup = await payingMember();

    expect(
      await setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        setup.paid.communityId,
        setup.paid.memberId,
      ),
    ).toEqual({ paying: false });
  });

  it("refuses a regular member", async () => {
    const setup = await payingMember();

    await expect(
      setup.harness.service.getMemberBilling(
        user(setup.paid.memberId),
        setup.paid.communityId,
        setup.payerId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not show a member of another community", async () => {
    const setup = await payingMember();
    const other = await payingMember();

    await expect(
      setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        other.paid.communityId,
        other.payerId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        setup.paid.communityId,
        other.payerId,
      ),
    ).toEqual({ paying: false });
  });

  it("refuses an unknown community", async () => {
    const setup = await payingMember();

    await expect(
      setup.harness.service.getMemberBilling(
        user(setup.paid.ownerId),
        "00000000-0000-7000-8000-000000000000",
        setup.payerId,
      ),
    ).rejects.toBeInstanceOf(PaymentsNotFoundError);
  });
});
