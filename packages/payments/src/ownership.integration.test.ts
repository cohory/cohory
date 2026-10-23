import { ForbiddenError } from "@cohory/authz";
import type { CommunityId, Database } from "@cohory/db";
import { memberships, outbox, paymentConnections, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConnectedError, PaymentAccountReviewRequiredError } from "./errors";
import { paidMembershipEventsTopic, type PaidMembershipEvent } from "./exit/events";
import type { SubscriptionRecord } from "./repository";
import {
  cloudEnv,
  communityEnv,
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

async function setRole(
  communityId: CommunityId,
  userId: string,
  role: "owner" | "admin",
): Promise<void> {
  await admin.db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, userId)));
}

async function transfer(paid: PaidCommunity): Promise<void> {
  await setRole(paid.communityId, paid.ownerId, "admin");
  await setRole(paid.communityId, paid.adminId, "owner");
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

async function connectionsOf(communityId: CommunityId) {
  return admin.db
    .select()
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, communityId));
}

async function noticesOf(communityId: CommunityId): Promise<PaidMembershipEvent[]> {
  const rows = await admin.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.communityId, communityId), eq(outbox.topic, paidMembershipEventsTopic)));
  return rows.flatMap((row) => (row.payload as { events: PaidMembershipEvent[] }).events);
}

async function emailOf(userId: string): Promise<string | undefined> {
  const [row] = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email;
}

async function paidSetup() {
  const harness = createHarness(probe.db, cloudEnv({ platformFeeBps: 200 }));
  const paid = await setupPaidCommunity(admin.db, harness);
  return { harness, paid };
}

describe("payments after an ownership transfer", () => {
  it("pauses checkouts after a transfer until the new owner decides", async () => {
    const { harness, paid } = await paidSetup();
    await paying(harness, paid);
    await paying(harness, paid, { origin: "linked_import" });
    expect((await harness.service.getPlan({ kind: "guest" }, paid.communityId))?.purchasable).toBe(
      true,
    );

    await transfer(paid);

    expect((await harness.service.getPlan({ kind: "guest" }, paid.communityId))?.purchasable).toBe(
      false,
    );
    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toBeInstanceOf(NotConnectedError);
    expect(harness.gateway.writes("createCheckoutSession")).toEqual([]);
    const review = await harness.service.getOwnershipReview(user(paid.adminId), paid.communityId);
    expect(review).toEqual({
      previousOwnerName: "Buyer",
      provider: "stripe_connect",
      cohory: 1,
      linkedImports: 1,
    });
  });

  it("has nothing to review when the owner never changed or nothing is connected", async () => {
    const { harness, paid } = await paidSetup();
    expect(
      await harness.service.getOwnershipReview(user(paid.ownerId), paid.communityId),
    ).toBeNull();

    const free = await insertCommunity(admin.db);
    const owner = await insertMember(admin.db, free, "owner");
    expect(await harness.service.getOwnershipReview(user(owner), free)).toBeNull();
  });

  it("resumes checkouts when the new owner keeps the existing account, fee unchanged", async () => {
    const { harness, paid } = await paidSetup();
    const [before] = await connectionsOf(paid.communityId);
    await transfer(paid);

    const view = await harness.service.keepPaymentAccount(user(paid.adminId), paid.communityId);

    expect(view).toMatchObject({
      id: before?.id,
      status: "active",
      externalAccountId: paid.accountId,
    });
    const [after] = await connectionsOf(paid.communityId);
    expect(after?.acceptedOwnerId).toBe(paid.adminId);
    expect(
      await harness.service.getOwnershipReview(user(paid.adminId), paid.communityId),
    ).toBeNull();
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    const [checkout] = harness.gateway.writes("createCheckoutSession");
    expect(checkout?.account).toBe(paid.accountId);
    expect(checkout?.input).toMatchObject({ applicationFeePercent: 2 });
  });

  it("does not notify paying members when the new owner keeps the account", async () => {
    const { harness, paid } = await paidSetup();
    const sub = await paying(harness, paid);
    await transfer(paid);

    await harness.service.keepPaymentAccount(user(paid.adminId), paid.communityId);

    const memberNotices = (await noticesOf(paid.communityId)).filter(
      (event) =>
        event.type === "paid_membership.changed" &&
        event.payload.recipients.some((recipient) => recipient.userId === sub.userId),
    );
    expect(memberNotices).toEqual([]);
    expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
    expect(harness.gateway.writes("scheduleCancellation")).toEqual([]);
  });

  it("refuses keepPaymentAccount for an admin", async () => {
    const { harness, paid } = await paidSetup();
    await transfer(paid);

    await expect(
      harness.service.keepPaymentAccount(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      harness.service.getOwnershipReview(user(paid.ownerId), paid.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [connection] = await connectionsOf(paid.communityId);
    expect(connection?.acceptedOwnerId).toBe(paid.ownerId);
  });

  it("refuses to reuse the previous owner's account for a new onboarding link", async () => {
    const { harness, paid } = await paidSetup();
    await transfer(paid);
    const links = harness.gateway.writes("createOnboardingLink").length;

    await expect(
      harness.service.connectStripe(user(paid.adminId), paid.communityId, {
        acceptCreatorTerms: true,
      }),
    ).rejects.toBeInstanceOf(PaymentAccountReviewRequiredError);
    expect(harness.gateway.writes("createOnboardingLink")).toHaveLength(links);

    await harness.service.keepPaymentAccount(user(paid.adminId), paid.communityId);
    const resumed = await harness.service.connectStripe(user(paid.adminId), paid.communityId, {
      acceptCreatorTerms: true,
    });
    expect(resumed.connection.externalAccountId).toBe(paid.accountId);
  });

  it("disconnects the old account with the new owner's choice before a new one can connect", async () => {
    const { harness, paid } = await paidSetup();
    const sub = await paying(harness, paid);
    await transfer(paid);

    const closed = await harness.service.disconnectStripe(user(paid.adminId), paid.communityId, {
      memberChoice: "take_members",
    });

    expect(closed.status).toBe("disconnected");
    expect(
      harness.gateway.subscriptions.get(sub.externalSubscriptionId)?.applicationFeePercent,
    ).toBeNull();
    const [notice] = (await noticesOf(paid.communityId)).flatMap((event) =>
      event.type === "paid_membership.changed" && event.payload.change === "billed_by_creator"
        ? [event.payload]
        : [],
    );
    expect(notice?.recipients.map((r) => r.userId)).toEqual([sub.userId]);
    expect(notice?.supportContact).toBe(await emailOf(paid.ownerId));
    expect(notice?.actorId).toBe(paid.adminId);

    const fresh = await harness.service.connectStripe(user(paid.adminId), paid.communityId, {
      acceptCreatorTerms: true,
    });
    expect(fresh.connection.externalAccountId).not.toBe(paid.accountId);
    const rows = await connectionsOf(paid.communityId);
    expect(rows.find((row) => row.id === fresh.connection.id)?.acceptedOwnerId).toBe(paid.adminId);
    expect(rows.filter((row) => row.status !== "disconnected")).toHaveLength(1);
  });

  it("records the connecting owner on every new connection", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    harness.gateway.accounts.set("acct_own", {
      id: "acct_own",
      chargesEnabled: true,
      detailsSubmitted: true,
      livemode: false,
      country: "us",
    });

    await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "sk_test_owner",
      webhookSecret: "whsec_owner",
    });

    const [connection] = await connectionsOf(communityId);
    expect(connection?.acceptedOwnerId).toBe(ownerId);
    const newOwner = await insertMember(admin.db, communityId, "admin");
    await setRole(communityId, ownerId, "admin");
    await setRole(communityId, newOwner, "owner");
    await expect(
      harness.service.connectOwnKeys(user(newOwner), communityId, {
        secretKey: "sk_test_new",
        webhookSecret: "whsec_new",
      }),
    ).rejects.toBeInstanceOf(PaymentAccountReviewRequiredError);
  });
});
