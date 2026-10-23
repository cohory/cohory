import { ForbiddenError } from "@cohory/authz";
import { getMembership, withCommunity, type CommunityId, type Database } from "@cohory/db";
import {
  auditLog,
  memberships,
  payments,
  subscriptionLinks,
  subscriptions,
  users,
} from "@cohory/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AlreadySubscribedError,
  EditionMismatchError,
  NotConnectedError,
  PaymentsValidationError,
} from "./errors";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import {
  createHarness,
  existingSubscriber,
  setupPaidCommunity,
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

async function emailOf(userId: string): Promise<string> {
  const [row] = await admin.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email ?? "";
}

async function verified(userId: string): Promise<string> {
  await admin.db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  return emailOf(userId);
}

// The Cloud Edition does not offer linking (0042). These tests keep the Connect path working for
// the day Cloud can attach an account that already holds subscriptions.
function linkingCloudEnv(overrides: Parameters<typeof cloudEnv>[0] = {}) {
  return cloudEnv({ subscriptionLinking: true, ...overrides });
}

async function paidSetup(): Promise<{ harness: Harness; paid: PaidCommunity }> {
  const harness = createHarness(probe.db, linkingCloudEnv());
  return { harness, paid: await setupPaidCommunity(admin.db, harness) };
}

describe("discovering existing subscriptions", () => {
  it("lists active, trialing, and past due subscriptions on the connected account for the owner and admins", async () => {
    const { harness, paid } = await paidSetup();
    const active = existingSubscriber(harness.gateway, "ada@example.test");
    const trialing = existingSubscriber(harness.gateway, "bo@example.test", { status: "trialing" });
    const pastDue = existingSubscriber(harness.gateway, "cy@example.test", { status: "past_due" });
    existingSubscriber(harness.gateway, "dee@example.test", { status: "incomplete" });
    existingSubscriber(harness.gateway, "eve@example.test", { status: "unpaid" });

    const discovery = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
    );

    expect(discovery.rows.map((row) => row.subscriptionId)).toEqual([
      active.summary.id,
      trialing.summary.id,
      pastDue.summary.id,
    ]);
    expect(discovery.rows[0]).toMatchObject({
      customerId: active.summary.customerId,
      email: "ada@example.test",
      status: "active",
      priceId: active.summary.priceId,
      unitAmountMinor: 2900,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
    });
    expect(discovery.nextCursor).toBeNull();
    const listed = harness.gateway.writes("listSubscriptions");
    expect(listed.at(-1)?.account).toBe(paid.accountId);

    const asAdmin = await harness.service.discoverSubscriptions(
      user(paid.adminId),
      paid.communityId,
    );
    expect(asAdmin.rows).toHaveLength(3);
  });

  it("pages through the account with a cursor", async () => {
    const { harness, paid } = await paidSetup();
    const created = Array.from({ length: 3 }, (_, index) =>
      existingSubscriber(harness.gateway, `page${index}@example.test`),
    );

    const first = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
      {
        limit: 2,
      },
    );
    expect(first.rows.map((row) => row.subscriptionId)).toEqual([
      created[0]?.summary.id,
      created[1]?.summary.id,
    ]);
    expect(first.nextCursor).toBe(created[1]?.summary.id);

    const second = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
      {
        cursor: first.nextCursor,
        limit: 2,
      },
    );
    expect(second.rows.map((row) => row.subscriptionId)).toEqual([created[2]?.summary.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses moderators, members, and outsiders", async () => {
    const { harness, paid } = await paidSetup();
    const moderatorId = await insertMember(admin.db, paid.communityId, "moderator");
    for (const id of [moderatorId, paid.memberId, paid.buyerId]) {
      await expect(
        harness.service.discoverSubscriptions(user(id), paid.communityId),
      ).rejects.toThrow(ForbiddenError);
    }
    expect(harness.gateway.writes("listSubscriptions")).toHaveLength(0);
  });

  it("is not offered on the Cloud Edition, where the connected account is always new", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const subscriber = existingSubscriber(harness.gateway, "cloud@example.test");

    await expect(
      harness.service.discoverSubscriptions(user(paid.ownerId), paid.communityId),
    ).rejects.toThrow(EditionMismatchError);
    await expect(
      harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
        rows: [{ subscriptionId: subscriber.summary.id, action: "invite", interval: "month" }],
      }),
    ).rejects.toThrow(EditionMismatchError);
    await expect(
      harness.service.claimInvitedSubscriptions(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow(EditionMismatchError);
    expect(harness.gateway.writes("listSubscriptions")).toHaveLength(0);
  });

  it("needs a connected Stripe account", async () => {
    const harness = createHarness(probe.db, linkingCloudEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await expect(harness.service.discoverSubscriptions(user(ownerId), communityId)).rejects.toThrow(
      NotConnectedError,
    );
  });

  it("reads the creator's own account when the Community Edition uses own keys", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");
    await harness.service.connectOwnKeys(user(ownerId), communityId, {
      secretKey: "rk_test_owner123",
      webhookSecret: "whsec_owner123",
    });
    existingSubscriber(harness.gateway, "own@example.test");

    const discovery = await harness.service.discoverSubscriptions(user(ownerId), communityId);

    expect(discovery.rows).toHaveLength(1);
    expect(harness.gateway.writes("listSubscriptions").at(-1)?.account).toBeNull();
  });

  it("marks subscriptions another platform created and ones cohory already mirrors", async () => {
    const { harness, paid } = await paidSetup();
    const foreign = existingSubscriber(harness.gateway, "foreign@example.test", {
      createdByApplication: "ca_otherplatform",
    });
    const ours = existingSubscriber(harness.gateway, "ours@example.test", {
      createdByApplication: "ca_cohory",
      metadata: { cohory_community_id: paid.communityId },
    });

    const discovery = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
    );

    const byId = new Map(discovery.rows.map((row) => [row.subscriptionId, row]));
    expect(byId.get(foreign.summary.id)?.block).toBe("other_platform");
    expect(byId.get(ours.summary.id)?.block).toBe("already_linked");
  });
});

describe("subscriptions created through this platform", () => {
  it("are linkable when STRIPE_CONNECT_CLIENT_ID names this platform", async () => {
    const harness = createHarness(
      probe.db,
      linkingCloudEnv({ connectClientId: "ca_cohoryplatform" }),
    );
    const paid = await setupPaidCommunity(admin.db, harness);
    const ours = existingSubscriber(harness.gateway, "ours@example.test", {
      createdByApplication: "ca_cohoryplatform",
    });
    const theirs = existingSubscriber(harness.gateway, "theirs@example.test", {
      createdByApplication: "ca_someoneelse",
    });

    const discovery = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
    );

    const byId = new Map(discovery.rows.map((row) => [row.subscriptionId, row]));
    expect(byId.get(ours.summary.id)).toMatchObject({ block: null, proposed: "invite" });
    expect(byId.get(theirs.summary.id)?.block).toBe("other_platform");
  });
});

describe("previewing matches", () => {
  it("proposes an action per subscription from the customer email", async () => {
    const { harness, paid } = await paidSetup();
    const memberEmail = await verified(paid.memberId);
    const outsiderEmail = await verified(paid.buyerId);
    const unverifiedId = await insertMember(admin.db, paid.communityId, "member");
    const bannedId = await insertMember(admin.db, paid.communityId, "member", "banned");
    const member = existingSubscriber(harness.gateway, memberEmail.toUpperCase());
    const outsider = existingSubscriber(harness.gateway, outsiderEmail);
    const unverified = existingSubscriber(harness.gateway, await emailOf(unverifiedId));
    const stranger = existingSubscriber(harness.gateway, "stranger@example.test", {
      interval: "week",
    });
    const banned = existingSubscriber(harness.gateway, await verified(bannedId));
    const noEmail = existingSubscriber(harness.gateway, null);

    const discovery = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
    );

    const byId = new Map(discovery.rows.map((row) => [row.subscriptionId, row]));
    expect(byId.get(member.summary.id)).toMatchObject({
      email: memberEmail.toLowerCase(),
      match: { kind: "member", userId: paid.memberId },
      proposed: "link_member",
      suggestedInterval: "month",
    });
    expect(byId.get(outsider.summary.id)).toMatchObject({
      match: { kind: "none" },
      proposed: "invite",
      allowed: ["invite", "skip"],
    });
    expect(byId.get(unverified.summary.id)).toMatchObject({
      match: { kind: "unverified" },
      proposed: "invite",
    });
    expect(byId.get(stranger.summary.id)).toMatchObject({
      match: { kind: "none" },
      proposed: "invite",
      suggestedInterval: null,
    });
    expect(byId.get(banned.summary.id)).toMatchObject({ block: "banned", proposed: "skip" });
    expect(byId.get(noEmail.summary.id)).toMatchObject({ block: "no_email", proposed: "skip" });
    expect(JSON.stringify(byId.get(outsider.summary.id))).not.toContain(paid.buyerId);
    expect(discovery).toMatchObject({
      plan: { currency: "usd", monthlyPriceMinor: 4900, annualPriceMinor: 49_000 },
      edition: "cloud",
      platformFeeBps: 200,
      canAddPlatformFee: true,
    });
  });
  it("on the Cloud Edition shows an account outside the community like an unknown address", async () => {
    const { harness, paid } = await paidSetup();
    const verifiedOutsider = existingSubscriber(harness.gateway, await verified(paid.buyerId));
    const unverifiedOutsider = existingSubscriber(
      harness.gateway,
      await emailOf(await insertUser(admin.db)),
    );
    const leftId = await insertMember(admin.db, paid.communityId, "member", "removed");
    const left = existingSubscriber(harness.gateway, await verified(leftId));
    const unknown = existingSubscriber(harness.gateway, "unknown@example.test");

    const discovery = await harness.service.discoverSubscriptions(
      user(paid.ownerId),
      paid.communityId,
    );

    const rows = new Map(discovery.rows.map((row) => [row.subscriptionId, row]));
    const shape = (id: string) => {
      const row = rows.get(id);
      return {
        match: row?.match,
        block: row?.block,
        proposed: row?.proposed,
        allowed: row?.allowed,
      };
    };
    const expected = shape(unknown.summary.id);
    expect(expected).toEqual({
      match: { kind: "none" },
      block: null,
      proposed: "invite",
      allowed: ["invite", "skip"],
    });
    expect(shape(verifiedOutsider.summary.id)).toEqual(expected);
    expect(shape(unverifiedOutsider.summary.id)).toEqual(expected);
    expect(shape(left.summary.id)).toEqual(expected);
  });

  it("on the Community Edition matches verified accounts outside the community", async () => {
    const { harness, communityId, ownerId } = await ownKeysSetup();
    const outsiderId = await insertUser(admin.db);
    const outsider = existingSubscriber(harness.gateway, await verified(outsiderId));
    const unverified = existingSubscriber(
      harness.gateway,
      await emailOf(await insertUser(admin.db)),
    );

    const discovery = await harness.service.discoverSubscriptions(user(ownerId), communityId);

    const rows = new Map(discovery.rows.map((row) => [row.subscriptionId, row]));
    expect(rows.get(outsider.summary.id)).toMatchObject({
      match: { kind: "user", userId: outsiderId },
      proposed: "link_and_add",
    });
    expect(rows.get(unverified.summary.id)).toMatchObject({
      match: { kind: "unverified" },
      proposed: "invite",
    });
  });
});

async function ownKeysSetup(): Promise<{
  harness: Harness;
  communityId: CommunityId;
  ownerId: string;
}> {
  const harness = createHarness(probe.db, communityEnv());
  const communityId = await insertCommunity(admin.db);
  const ownerId = await insertMember(admin.db, communityId, "owner");
  await harness.service.connectOwnKeys(user(ownerId), communityId, {
    secretKey: "rk_test_owner123",
    webhookSecret: "whsec_owner123",
  });
  return { harness, communityId, ownerId };
}

async function linkNewMember(
  harness: Harness,
  paid: PaidCommunity,
  subscriptionId: string,
  personId: string,
  interval: "month" | "year",
) {
  const result = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
    rows: [{ subscriptionId, action: "link_and_add", interval }],
  });
  expect(result.rows[0]?.outcome).toBe("invited");
  expect(
    await harness.service.claimInvitedSubscriptions(user(personId), paid.communityId),
  ).toMatchObject({ claimed: 1 });
}

async function mirrorOf(externalId: string) {
  const [row] = await admin.db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.externalSubscriptionId, externalId));
  return row ?? null;
}

async function linksOf(paid: PaidCommunity) {
  return admin.db
    .select()
    .from(subscriptionLinks)
    .where(eq(subscriptionLinks.communityId, paid.communityId))
    .orderBy(asc(subscriptionLinks.createdAt));
}

async function auditActions(paid: PaidCommunity): Promise<string[]> {
  const rows = await admin.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.communityId, paid.communityId))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((row) => row.action);
}

async function membershipStatus(paid: PaidCommunity, userId: string) {
  return (await getMembership(withCommunity(admin.db, paid.communityId), userId))?.status ?? null;
}

describe("linking existing subscriptions", () => {
  it("links a member's subscription without a platform fee and keeps their access", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.memberId), {
      interval: "week",
    });

    const result = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "link_member", interval: "month" }],
    });

    expect(result.rows).toEqual([
      {
        subscriptionId: sub.summary.id,
        email: (await emailOf(paid.memberId)).toLowerCase(),
        outcome: "linked",
        reason: null,
        platformFeeAdded: false,
      },
    ]);
    expect(await mirrorOf(sub.summary.id)).toMatchObject({
      userId: paid.memberId,
      origin: "linked_import",
      externalPriceId: sub.summary.priceId,
      planId: paid.planId,
      interval: "month",
      accessState: "granted",
      applicationFeeBps: 0,
    });
    const [link] = await linksOf(paid);
    expect(link).toMatchObject({ status: "linked", userId: paid.memberId, applicationFeeBps: 0 });
    expect(await auditActions(paid)).toContain("subscription.linked");
    expect(harness.gateway.writes("setSubscriptionApplicationFee")).toHaveLength(0);
    const access = await harness.service.getMembershipAccess(paid.communityId, paid.memberId);
    expect(access).toMatchObject({ level: "member", source: "subscription", state: "granted" });
  });

  it("on the Cloud Edition invites an account outside the community instead of adding it", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId));
    const input = {
      rows: [
        {
          subscriptionId: sub.summary.id,
          action: "link_and_add" as const,
          interval: "year" as const,
        },
      ],
    };

    const first = await harness.service.linkSubscriptions(
      user(paid.adminId),
      paid.communityId,
      input,
    );
    const second = await harness.service.linkSubscriptions(
      user(paid.ownerId),
      paid.communityId,
      input,
    );

    expect(first.rows[0]).toMatchObject({ outcome: "invited", reason: null });
    expect(first.invitedEmails).toEqual([(await emailOf(paid.buyerId)).toLowerCase()]);
    expect(second.rows[0]).toMatchObject({ outcome: "already_linked", reason: "invited" });
    expect(await membershipStatus(paid, paid.buyerId)).toBeNull();
    expect(await mirrorOf(sub.summary.id)).toBeNull();
    expect(await linksOf(paid)).toMatchObject([{ status: "invited", userId: null }]);

    expect(
      await harness.service.claimInvitedSubscriptions(user(paid.buyerId), paid.communityId),
    ).toEqual({ claimed: 1, waitingForVerification: false });
    expect(await membershipStatus(paid, paid.buyerId)).toBe("active");
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(true);
  });

  it("on the Community Edition adds a membership for a verified account and is idempotent per Stripe subscription", async () => {
    const { harness, communityId, ownerId } = await ownKeysSetup();
    const outsiderId = await insertUser(admin.db);
    const sub = existingSubscriber(harness.gateway, await verified(outsiderId));
    const input = {
      rows: [
        {
          subscriptionId: sub.summary.id,
          action: "link_and_add" as const,
          interval: "year" as const,
        },
      ],
    };

    const first = await harness.service.linkSubscriptions(user(ownerId), communityId, input);
    const second = await harness.service.linkSubscriptions(user(ownerId), communityId, input);

    expect(first.rows[0]?.outcome).toBe("added");
    expect(second.rows[0]).toMatchObject({ outcome: "already_linked", reason: "already_linked" });
    expect((await getMembership(withCommunity(admin.db, communityId), outsiderId))?.status).toBe(
      "active",
    );
    expect(await mirrorOf(sub.summary.id)).toMatchObject({ userId: outsiderId });
  });

  it("adds the platform fee going forward only when the creator asks for it", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId));

    const result = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "invite", interval: "month" }],
      addPlatformFee: true,
    });
    expect(result.rows[0]).toMatchObject({ outcome: "invited", platformFeeAdded: false });
    await harness.service.claimInvitedSubscriptions(user(paid.buyerId), paid.communityId);

    const [call] = harness.gateway.writes("setSubscriptionApplicationFee");
    expect(call).toMatchObject({
      account: paid.accountId,
      idempotencyKey: `link:${paid.connectionId}:${sub.summary.id}:fee:200`,
      input: { subscriptionId: sub.summary.id, percent: 2 },
    });
    expect((await mirrorOf(sub.summary.id))?.applicationFeeBps).toBe(200);
    expect((await linksOf(paid))[0]?.applicationFeeBps).toBe(200);
  });

  it("re-checks every row against Stripe and the members list before writing", async () => {
    const { harness, paid } = await paidSetup();
    const stranger = existingSubscriber(harness.gateway, "nobody@example.test");
    const foreign = existingSubscriber(harness.gateway, await verified(paid.memberId), {
      createdByApplication: "ca_other",
    });
    const canceled = existingSubscriber(harness.gateway, "gone@example.test", {
      status: "canceled",
    });

    const result = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [
        { subscriptionId: stranger.summary.id, action: "link_member", interval: "month" },
        { subscriptionId: foreign.summary.id, action: "link_member", interval: "month" },
        { subscriptionId: canceled.summary.id, action: "invite", interval: "month" },
        { subscriptionId: "sub_missing", action: "skip" },
      ],
    });

    expect(result.rows.map((row) => [row.outcome, row.reason])).toEqual([
      ["refused", "match_changed"],
      ["refused", "other_platform"],
      ["refused", "status"],
      ["skipped", null],
    ]);
    expect(await linksOf(paid)).toHaveLength(0);
  });

  it("needs an interval for every linked row and refuses members", async () => {
    const { harness, paid } = await paidSetup();
    await expect(
      harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
        rows: [{ subscriptionId: "sub_1", action: "invite" }],
      }),
    ).rejects.toThrow(PaymentsValidationError);
    await expect(
      harness.service.linkSubscriptions(user(paid.memberId), paid.communityId, {
        rows: [{ subscriptionId: "sub_1", action: "skip" }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("invited subscribers", () => {
  it("activates the membership when the person signs up and verifies that email", async () => {
    const { harness, paid } = await paidSetup();
    const email = `invitee-${paid.communityId.slice(-8)}@example.test`;
    const sub = existingSubscriber(harness.gateway, email);

    const result = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "invite", interval: "month" }],
    });
    expect(result).toMatchObject({ invitedEmails: [email], rows: [{ outcome: "invited" }] });
    expect(await mirrorOf(sub.summary.id)).toBeNull();

    const again = await harness.service.discoverSubscriptions(user(paid.ownerId), paid.communityId);
    expect(again.rows[0]).toMatchObject({ block: "invited", proposed: "skip" });

    const [row] = await admin.db
      .insert(users)
      .values({ name: "Invitee", email: email.toUpperCase() })
      .returning({ id: users.id });
    const inviteeId = row?.id ?? "";
    expect(
      await harness.service.claimInvitedSubscriptions(user(inviteeId), paid.communityId),
    ).toEqual({
      claimed: 0,
      waitingForVerification: true,
    });

    await verified(inviteeId);
    expect(
      await harness.service.claimInvitedSubscriptions(user(inviteeId), paid.communityId),
    ).toEqual({
      claimed: 1,
      waitingForVerification: false,
    });
    expect(
      await harness.service.claimInvitedSubscriptions(user(inviteeId), paid.communityId),
    ).toEqual({
      claimed: 0,
      waitingForVerification: false,
    });
    expect(await membershipStatus(paid, inviteeId)).toBe("active");
    expect(await mirrorOf(sub.summary.id)).toMatchObject({
      userId: inviteeId,
      origin: "linked_import",
    });
    expect((await linksOf(paid))[0]).toMatchObject({ status: "linked", userId: inviteeId });
    expect(await auditActions(paid)).toEqual(
      expect.arrayContaining(["subscription.invited", "subscription.claimed"]),
    );
    const listed = await harness.service.listSubscriptionLinks(
      user(paid.adminId),
      paid.communityId,
    );
    expect(listed).toMatchObject([{ email, status: "linked" }]);
  });

  it("does not claim for someone whose email does not match or after the subscription ended", async () => {
    const { harness, paid } = await paidSetup();
    const email = `ended-${paid.communityId.slice(-8)}@example.test`;
    const sub = existingSubscriber(harness.gateway, email);
    await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "invite", interval: "month" }],
    });
    const otherEmail = await verified(paid.buyerId);
    expect(otherEmail).not.toBe(email);
    expect(
      await harness.service.claimInvitedSubscriptions(user(paid.buyerId), paid.communityId),
    ).toEqual({
      claimed: 0,
      waitingForVerification: false,
    });

    harness.gateway.summaries.set(sub.summary.id, { ...sub.summary, status: "canceled" });
    const [row] = await admin.db
      .insert(users)
      .values({ name: "Late", email, emailVerified: true })
      .returning({ id: users.id });
    expect(
      await harness.service.claimInvitedSubscriptions(user(row?.id ?? ""), paid.communityId),
    ).toMatchObject({ claimed: 0 });
    expect(await mirrorOf(sub.summary.id)).toBeNull();
  });
});

describe("webhooks after linking", () => {
  async function deliver(harness: Harness, paid: PaidCommunity, type: string, id: string) {
    const event = signedEvent(type, { id }, { account: paid.accountId });
    return harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery({
        rawBody: event.rawBody,
        signature: event.signature,
      }),
    );
  }

  it("keeps the mirror and the entitlement in sync through subscription and invoice events", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId), {
      interval: "week",
    });
    await linkNewMember(harness, paid, sub.summary.id, paid.buyerId, "year");

    harness.clock.now = new Date("2026-10-19T10:00:00.000Z");
    harness.gateway.subscriptions.set(sub.summary.id, {
      ...sub.subscription,
      status: "past_due",
      priceId: "price_new",
    });
    expect(await deliver(harness, paid, "customer.subscription.updated", sub.summary.id)).toEqual({
      status: 200,
      outcome: "processed",
    });
    expect(await mirrorOf(sub.summary.id)).toMatchObject({
      providerStatus: "past_due",
      accessState: "grace",
      interval: "year",
      planId: paid.planId,
      origin: "linked_import",
      externalPriceId: "price_new",
    });

    harness.clock.now = new Date("2026-10-20T10:00:00.000Z");
    const renewed = new Date("2026-11-20T10:00:00.000Z");
    harness.gateway.subscriptions.set(sub.summary.id, {
      ...sub.subscription,
      status: "active",
      currentPeriodEnd: renewed,
    });
    const invoiceId = `in_linked${sub.summary.id}`;
    harness.gateway.invoices.set(invoiceId, {
      id: invoiceId,
      subscriptionId: sub.summary.id,
      status: "paid",
      amountPaid: 2900,
      amountDue: 2900,
      attemptCount: 1,
      nextPaymentAttemptAt: null,
      taxMinor: 0,
      currency: "usd",
      paymentIntentIds: [`pi_linked${sub.summary.id}`],
      paidAt: harness.clock.now,
    });
    expect(await deliver(harness, paid, "invoice.paid", invoiceId)).toMatchObject({
      outcome: "processed",
    });
    const mirror = await mirrorOf(sub.summary.id);
    expect(mirror).toMatchObject({ accessState: "granted", currentPeriodEnd: renewed });
    const [payment] = await admin.db
      .select()
      .from(payments)
      .where(eq(payments.externalInvoiceId, invoiceId));
    expect(payment).toMatchObject({ subscriptionId: mirror?.id, amountMinor: 2900 });

    harness.clock.now = new Date("2026-10-21T10:00:00.000Z");
    harness.gateway.subscriptions.set(sub.summary.id, {
      ...sub.subscription,
      status: "canceled",
      endedAt: harness.clock.now,
    });
    await deliver(harness, paid, "customer.subscription.deleted", sub.summary.id);
    expect(await membershipStatus(paid, paid.buyerId)).toBe("removed");
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(false);
  });
});

describe("resubscribing after a linked subscription ends", () => {
  it("offers a new subscription with a trial until the old one ends", async () => {
    const { harness, paid } = await paidSetup();
    const endsAt = new Date("2026-11-02T10:00:00.000Z");
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId), {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: endsAt,
    });
    await linkNewMember(harness, paid, sub.summary.id, paid.buyerId, "month");

    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.resubscribe).toEqual({ endsAt });
    expect(mine.subscription?.linked).toBe(true);

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
      interval: "month",
    });
    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: endsAt });
  });

  it("starts at once when the old subscription ends within two days", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId), {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date("2026-10-19T10:00:00.000Z"),
    });
    await linkNewMember(harness, paid, sub.summary.id, paid.buyerId, "month");
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {});
    expect(harness.gateway.lastCheckout()).toMatchObject({ trialEnd: null });
  });

  it("does not offer it while the linked subscription keeps renewing", async () => {
    const { harness, paid } = await paidSetup();
    const sub = existingSubscriber(harness.gateway, await verified(paid.buyerId));
    await linkNewMember(harness, paid, sub.summary.id, paid.buyerId, "month");
    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);
    expect(mine.resubscribe).toBeNull();
    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {}),
    ).rejects.toThrow(AlreadySubscribedError);
  });
});

async function banAddress(db: Database, communityId: CommunityId, email: string): Promise<void> {
  const formerId = await insertMember(db, communityId, "member", "banned");
  await db
    .update(memberships)
    .set({ bannedEmail: email })
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, formerId)));
}

describe("addresses banned in the community", () => {
  it("on the Community Edition refuses to link and add an account whose email is banned", async () => {
    const { harness, communityId, ownerId } = await ownKeysSetup();
    const outsiderId = await insertUser(admin.db);
    const email = await verified(outsiderId);
    const sub = existingSubscriber(harness.gateway, email);
    await banAddress(admin.db, communityId, email);

    const discovery = await harness.service.discoverSubscriptions(user(ownerId), communityId);
    expect(discovery.rows[0]).toMatchObject({ block: "banned", proposed: "skip" });

    const result = await harness.service.linkSubscriptions(user(ownerId), communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "link_and_add", interval: "month" }],
    });

    expect(result.rows[0]).toMatchObject({ outcome: "refused", reason: "banned" });
    expect(await getMembership(withCommunity(admin.db, communityId), outsiderId)).toBeNull();
    expect(await mirrorOf(sub.summary.id)).toBeNull();
  });

  it("on the Cloud Edition neither invites a banned address nor lets it claim an earlier invite", async () => {
    const { harness, paid } = await paidSetup();
    const email = `banned-${paid.communityId.slice(-8)}@example.test`;
    const sub = existingSubscriber(harness.gateway, email);
    const later = existingSubscriber(harness.gateway, email);
    await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: sub.summary.id, action: "invite", interval: "month" }],
    });
    await banAddress(admin.db, paid.communityId, email);

    const refused = await harness.service.linkSubscriptions(user(paid.ownerId), paid.communityId, {
      rows: [{ subscriptionId: later.summary.id, action: "link_and_add", interval: "month" }],
    });
    expect(refused.rows[0]).toMatchObject({ outcome: "refused", reason: "banned" });
    expect(refused.invitedEmails).toEqual([]);

    const [row] = await admin.db
      .insert(users)
      .values({ name: "Banned", email, emailVerified: true })
      .returning({ id: users.id });
    const personId = row?.id ?? "";
    expect(
      await harness.service.claimInvitedSubscriptions(user(personId), paid.communityId),
    ).toEqual({ claimed: 0, waitingForVerification: false });
    expect(await membershipStatus(paid, personId)).toBeNull();
    expect(await mirrorOf(sub.summary.id)).toBeNull();
    expect(await linksOf(paid)).toMatchObject([{ status: "invited", userId: null }]);
  });
});
