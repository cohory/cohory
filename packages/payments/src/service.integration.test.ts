import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { getCommunityById, newId, type Database } from "@cohory/db";
import { communities, membershipPlans, paymentConnections } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createKeyring, decryptSecret } from "./crypto";
import {
  AlreadyConnectedError,
  CurrencyLockedError,
  EditionMismatchError,
  IntervalUnavailableError,
  NoBillingAccountError,
  PaymentsNotFoundError,
  PaymentsValidationError,
  PlanUnavailableError,
  StripeRejectedError,
} from "./errors";
import { LiveKeyRefusedError } from "./config";
import {
  communityEnv,
  encryptionKey,
  insertCommunity,
  insertMember,
  insertUser,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import { createHarness, setupPaidCommunity } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

async function renameSlug(communityId: string): Promise<void> {
  await admin.db
    .update(communities)
    .set({ slug: `renamed-${newId().slice(-12)}` })
    .where(eq(communities.id, communityId));
}

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("connecting Stripe on Cloud", () => {
  it("creates a full dashboard connected account and an onboarding link for the owner", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const ownerId = await insertMember(admin.db, communityId, "owner");

    const result = await harness.service.connectStripe(user(ownerId), communityId, {
      acceptCreatorTerms: true,
    });

    expect(result.url).toMatch(/^https:\/\/connect\.stripe\.test\/setup\/acct_/);
    expect(result.connection).toMatchObject({
      provider: "stripe_connect",
      status: "onboarding",
      chargesEnabled: false,
    });
    const [create] = harness.gateway.writes("createConnectedAccount");
    expect(create?.idempotencyKey).toBe(`connect:${result.connection.id}:account`);
    const [link] = harness.gateway.writes("createOnboardingLink");
    const slug = (await getCommunityById(admin.db, communityId))?.slug;
    expect(link?.input).toMatchObject({
      refreshUrl: `http://localhost:3000/c/${slug}/manage/payments?stripe=refresh`,
      returnUrl: `http://localhost:3000/c/${slug}/manage/payments?stripe=return`,
    });
  });

  it("resumes onboarding on the same account when the owner connects again", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));

    const first = await harness.service.connectStripe(owner, communityId, {
      acceptCreatorTerms: true,
    });
    const second = await harness.service.connectStripe(owner, communityId, {
      acceptCreatorTerms: true,
    });

    expect(second.connection.id).toBe(first.connection.id);
    expect(second.connection.externalAccountId).toBe(first.connection.externalAccountId);
    expect(harness.gateway.writes("createConnectedAccount")).toHaveLength(1);
  });

  it("opens onboarding again after the owner renames the community address", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));

    await harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true });
    await renameSlug(communityId);
    await harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true });

    const [first, second] = harness.gateway.writes("createOnboardingLink");
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
  });

  it("asks Stripe for a fresh onboarding link on every click so a refresh never replays a used one", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));

    await harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true });
    await harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true });

    const [first, second] = harness.gateway.writes("createOnboardingLink");
    expect(first?.idempotencyKey).toMatch(/^connect:[0-9a-f-]+:link:/);
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it("marks the connection active once Stripe enables charges", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const { connection } = await harness.service.connectStripe(owner, communityId, {
      acceptCreatorTerms: true,
    });
    const accountId = connection.externalAccountId ?? "";

    harness.gateway.accounts.set(accountId, {
      id: accountId,
      chargesEnabled: false,
      detailsSubmitted: true,
      livemode: false,
      country: "us",
    });
    expect((await harness.service.refreshConnection(owner, communityId)).status).toBe("restricted");

    harness.gateway.accounts.set(accountId, {
      id: accountId,
      chargesEnabled: true,
      detailsSubmitted: true,
      livemode: false,
      country: "us",
    });
    const refreshed = await harness.service.refreshConnection(owner, communityId);
    expect(refreshed).toMatchObject({ status: "active", chargesEnabled: true });
  });

  it("lets only the owner connect and only managers see the overview", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const adminId = await insertMember(admin.db, communityId, "admin");
    const memberId = await insertMember(admin.db, communityId, "member");

    await expect(
      harness.service.connectStripe(user(adminId), communityId, { acceptCreatorTerms: true }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      harness.service.connectStripe({ kind: "guest" }, communityId, { acceptCreatorTerms: true }),
    ).rejects.toThrow(UnauthenticatedError);
    const overview = await harness.service.getPaymentsOverview(user(adminId), communityId);
    expect(overview).toMatchObject({
      edition: "cloud",
      platformFeeBps: 200,
      providers: ["stripe_connect", "polar"],
      connection: null,
    });
    await expect(harness.service.getPaymentsOverview(user(memberId), communityId)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses own keys on Cloud", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    await expect(
      harness.service.connectOwnKeys(owner, communityId, {
        secretKey: "sk_test_abc",
        webhookSecret: "whsec_abc",
      }),
    ).rejects.toThrow(EditionMismatchError);
  });

  it("does not leak another community through an unknown id", async () => {
    const harness = createHarness(probe.db);
    const owner = user(await insertUser(admin.db));
    await expect(harness.service.getPaymentsOverview(owner, newId())).rejects.toThrow(
      PaymentsNotFoundError,
    );
    await expect(harness.service.getPaymentsOverview(owner, "not-a-uuid")).rejects.toThrow(
      PaymentsNotFoundError,
    );
  });
});

describe("connecting own keys on the Community Edition", () => {
  it("stores the keys encrypted and reports the webhook path", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));

    const connection = await harness.service.connectOwnKeys(owner, communityId, {
      secretKey: "rk_test_owner123",
      webhookSecret: "whsec_owner123",
    });

    expect(connection).toMatchObject({
      provider: "stripe_own_keys",
      status: "active",
      webhookPath: `/api/webhooks/stripe/own/${connection.id}`,
    });
    const [row] = await admin.db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.id, connection.id));
    expect(row?.encryptedSecret).not.toContain("rk_test_owner123");
    expect(decryptSecret(row?.encryptedSecret ?? "", encryptionKey, connection.id)).toBe(
      "rk_test_owner123",
    );
    expect(decryptSecret(row?.webhookSecretEncrypted ?? "", encryptionKey, connection.id)).toBe(
      "whsec_owner123",
    );
  });

  it("refuses live keys outside production and Connect onboarding", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    await expect(
      harness.service.connectOwnKeys(owner, communityId, {
        secretKey: "sk_live_abc",
        webhookSecret: "whsec_abc",
      }),
    ).rejects.toThrow(LiveKeyRefusedError);
    await expect(
      harness.service.connectOwnKeys(owner, communityId, {
        secretKey: "pk_test_abc",
        webhookSecret: "whsec_abc",
      }),
    ).rejects.toThrow(PaymentsValidationError);
    await expect(
      harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true }),
    ).rejects.toThrow(EditionMismatchError);
  });

  it("creates checkouts without any application fee", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const buyer = user(await insertUser(admin.db));
    await harness.service.connectOwnKeys(owner, communityId, {
      secretKey: "sk_test_owner",
      webhookSecret: "whsec_owner",
    });
    await harness.service.upsertPlan(owner, communityId, {
      currency: "eur",
      monthlyPriceMinor: 1500,
    });

    await harness.service.createCheckoutSession(buyer, communityId);

    const [checkout] = harness.gateway.writes("createCheckoutSession");
    expect(checkout?.account).toBeNull();
    expect(checkout?.input).toMatchObject({ applicationFeePercent: null });
    const overview = await harness.service.getPaymentsOverview(owner, communityId);
    expect(overview.platformFeeBps).toBe(0);
  });
});

describe("membership plans", () => {
  it("creates the product and prices on the connected account and marks the community paid", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    const plan = await harness.service.getPlan({ kind: "guest" }, paid.communityId);

    expect(plan).toMatchObject({
      currency: "usd",
      monthlyPriceMinor: 4900,
      annualPriceMinor: 49_000,
      purchasable: true,
    });
    expect(harness.gateway.writes("createProduct")[0]).toMatchObject({
      account: paid.accountId,
      idempotencyKey: `plan:${paid.planId}:product`,
    });
    expect(harness.gateway.writes("createPrice").map((c) => c.idempotencyKey)).toEqual([
      `plan:${paid.planId}:price:month`,
      `plan:${paid.planId}:price:year`,
    ]);
    expect((await getCommunityById(admin.db, paid.communityId))?.currency).toBe("usd");
  });

  it("keeps the plan when the prices do not change", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const owner = user(paid.ownerId);

    const renamed = await harness.service.upsertPlan(owner, paid.communityId, {
      name: "Inner circle",
      currency: "usd",
      monthlyPriceMinor: 4900,
      annualPriceMinor: 49_000,
    });

    expect(renamed).toMatchObject({ id: paid.planId, name: "Inner circle" });
    expect(harness.gateway.writes("createPrice")).toHaveLength(2);
    const [rename] = harness.gateway.writes("updateProduct");
    expect(rename).toMatchObject({
      account: paid.accountId,
      input: { name: "Inner circle" },
    });
    expect(rename?.idempotencyKey).toMatch(new RegExp(`^plan:${paid.planId}:rename:`));
  });

  it("keeps the old plan name when Stripe refuses to rename the product", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const owner = user(paid.ownerId);
    const refuse = vi
      .spyOn(harness.gateway, "updateProduct")
      .mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({ message: "nope" }));

    await expect(
      harness.service.upsertPlan(owner, paid.communityId, {
        name: "Inner circle",
        currency: "usd",
        monthlyPriceMinor: 4900,
        annualPriceMinor: 49_000,
      }),
    ).rejects.toThrow(StripeRejectedError);

    expect(refuse).toHaveBeenCalledOnce();
    expect((await harness.service.getPlan(owner, paid.communityId))?.name).toBe("Membership");
  });

  it("lets the owner rename a plan whose existing price is below today's minimum", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await admin.db
      .update(membershipPlans)
      .set({ monthlyPriceMinor: 10, annualPriceMinor: null })
      .where(eq(membershipPlans.id, paid.planId));

    const renamed = await harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
      name: "Old price club",
      currency: "usd",
      monthlyPriceMinor: 10,
    });

    expect(renamed).toMatchObject({ id: paid.planId, name: "Old price club" });
    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "usd",
        monthlyPriceMinor: 20,
      }),
    ).rejects.toThrow(PaymentsValidationError);
  });

  it("refuses a price below Stripe's minimum charge for the currency", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "usd",
        monthlyPriceMinor: 49,
      }),
    ).rejects.toThrow(PaymentsValidationError);
    expect(harness.gateway.writes("createPrice")).toHaveLength(2);
  });

  it("creates a new plan version on a price change so existing subscribers keep their price", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const owner = user(paid.ownerId);

    const next = await harness.service.upsertPlan(owner, paid.communityId, {
      currency: "usd",
      monthlyPriceMinor: 5900,
    });

    expect(next.id).not.toBe(paid.planId);
    expect(next).toMatchObject({ monthlyPriceMinor: 5900, annualPriceMinor: null });
    expect(harness.gateway.writes("deactivatePrice")).toHaveLength(2);
  });

  it("locks the currency while a plan is active", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "eur",
        monthlyPriceMinor: 4900,
      }),
    ).rejects.toThrow(CurrencyLockedError);
  });

  it("makes the community free again when the plan is archived", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    await harness.service.archivePlan(user(paid.ownerId), paid.communityId);

    expect(await harness.service.getPlan({ kind: "guest" }, paid.communityId)).toBeNull();
    expect((await getCommunityById(admin.db, paid.communityId))?.currency).toBeNull();
    await expect(harness.service.archivePlan(user(paid.ownerId), paid.communityId)).rejects.toThrow(
      PaymentsNotFoundError,
    );
  });

  it("rejects plan changes from admins and invalid prices", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await expect(
      harness.service.upsertPlan(user(paid.adminId), paid.communityId, {
        currency: "usd",
        monthlyPriceMinor: 100,
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "usd",
        monthlyPriceMinor: 0,
      }),
    ).rejects.toThrow(PaymentsValidationError);
    await expect(
      harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
        currency: "usd",
        monthlyPriceMinor: 10.5,
      }),
    ).rejects.toThrow(PaymentsValidationError);
  });

  it("saves the price as a draft until a connection can take payments", async () => {
    const harness = createHarness(probe.db);
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    await harness.service.connectStripe(owner, communityId, { acceptCreatorTerms: true });

    const plan = await harness.service.upsertPlan(owner, communityId, {
      currency: "usd",
      monthlyPriceMinor: 100,
    });

    expect(plan.purchasable).toBe(false);
    expect(await harness.service.getPlan({ kind: "guest" }, communityId)).toBeNull();
    expect(harness.gateway.writes("createProduct")).toEqual([]);
  });
});

describe("checkout", () => {
  it("uses a fresh idempotency key for every checkout", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);

    const [first, second] = harness.gateway.writes("createCheckoutSession");
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
  });

  it("creates a subscription checkout on the connected account with the configured fee", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    const session = await harness.service.createCheckoutSession(
      user(paid.buyerId),
      paid.communityId,
      {
        interval: "year",
      },
    );

    expect(session.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [call] = harness.gateway.writes("createCheckoutSession");
    const slug = (await getCommunityById(admin.db, paid.communityId))?.slug;
    expect(call?.account).toBe(paid.accountId);
    expect(call?.idempotencyKey).toMatch(
      new RegExp(`^checkout:${paid.planId}:${paid.buyerId}:year:[0-9a-f-]{36}$`),
    );
    expect(call?.input).toMatchObject({
      applicationFeePercent: 2,
      clientReferenceId: paid.buyerId,
      customerId: null,
      metadata: {
        cohory_community_id: paid.communityId,
        cohory_user_id: paid.buyerId,
        cohory_plan_id: paid.planId,
      },
      successUrl: `http://localhost:3000/c/${slug}/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `http://localhost:3000/c/${slug}/membership?checkout=cancel`,
    });
    const priceId = (call?.input as { priceId: string }).priceId;
    expect(harness.gateway.prices.get(priceId)).toMatchObject({
      interval: "year",
      unitAmount: 49_000,
    });
  });

  it("expires the buyer's other open checkout so only one of them can be paid", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const other = await insertUser(admin.db);

    await harness.service.createCheckoutSession(user(other), paid.communityId);
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    const annual = await harness.service.createCheckoutSession(
      user(paid.buyerId),
      paid.communityId,
      { interval: "year" },
    );

    const [others, monthlySession, annualSession] = [...harness.gateway.checkoutSessions.values()];
    expect(others?.status).toBe("open");
    expect(monthlySession?.status).toBe("expired");
    expect(annualSession?.status).toBe("open");
    expect(annual.url).toContain(annualSession?.id ?? "-");
    const [expiry] = harness.gateway.writes("expireOpenCheckoutSessions");
    expect(expiry).toMatchObject({
      account: paid.accountId,
      idempotencyKey: `checkout-expire:${annualSession?.id}:${monthlySession?.id}`,
    });
  });

  it("opens a new session that can be paid when the buyer goes back to monthly", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const buyer = user(paid.buyerId);

    const first = await harness.service.createCheckoutSession(buyer, paid.communityId);
    await harness.service.createCheckoutSession(buyer, paid.communityId, { interval: "year" });
    const again = await harness.service.createCheckoutSession(buyer, paid.communityId);

    const sessions = [...harness.gateway.checkoutSessions.values()];
    expect(sessions.map((session) => session.status)).toEqual(["expired", "expired", "open"]);
    expect(again.url).not.toBe(first.url);
    expect(again.url).toContain(sessions[2]?.id ?? "-");
  });

  it("uses a fee rate from configuration, not a constant", async () => {
    const harness = createHarness(probe.db, {
      edition: "cloud",
      platformFeeBps: 250,
      nodeEnv: "test",
      stripeSecretKey: "sk_test_platform",
      webhookSecrets: ["whsec_connect"],
      encryptionKeys: createKeyring([encryptionKey]),
      appUrl: "http://localhost:3000",
      stripeApiBaseUrl: null,
      polarApiBaseUrl: null,
      connectClientId: null,
      polarEnabled: false,
      creatorTermsVersion: "1",
      subscriptionLinking: false,
    });
    const paid = await setupPaidCommunity(admin.db, harness);
    await harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId);
    expect(harness.gateway.lastCheckout()?.applicationFeePercent).toBe(2.5);
  });

  it("refuses staff, guests, banned people, and plans that cannot be bought", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    const bannedId = await insertMember(admin.db, paid.communityId, "member", "banned");

    await expect(
      harness.service.createCheckoutSession(user(paid.adminId), paid.communityId),
    ).rejects.toThrow();
    await expect(
      harness.service.createCheckoutSession({ kind: "guest" }, paid.communityId),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      harness.service.createCheckoutSession(user(bannedId), paid.communityId),
    ).rejects.toThrow(ForbiddenError);

    await harness.service.upsertPlan(user(paid.ownerId), paid.communityId, {
      currency: "usd",
      monthlyPriceMinor: 1000,
    });
    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId, {
        interval: "year",
      }),
    ).rejects.toThrow(IntervalUnavailableError);

    await harness.service.archivePlan(user(paid.ownerId), paid.communityId);
    await expect(
      harness.service.createCheckoutSession(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow(PlanUnavailableError);
  });

  it("explains that a portal needs a billing account first", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);
    await expect(
      harness.service.createPortalSession(user(paid.buyerId), paid.communityId),
    ).rejects.toThrow(NoBillingAccountError);
  });

  it("reports that payment is required for a visitor of a paid community", async () => {
    const harness = createHarness(probe.db);
    const paid = await setupPaidCommunity(admin.db, harness);

    const mine = await harness.service.getMyMembership(user(paid.buyerId), paid.communityId);

    expect(mine).toMatchObject({
      access: { level: "payment_required", reason: "no_subscription" },
      plan: { id: paid.planId, purchasable: true },
      subscription: null,
      canManageBilling: false,
    });
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.buyerId)).toBe(false);
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.memberId)).toBe(true);
    expect(await harness.service.hasActiveMembership(paid.communityId, paid.ownerId)).toBe(true);
  });
});

describe("connection conflicts", () => {
  it("does not start Connect onboarding over an own keys connection", async () => {
    const own = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    await own.service.connectOwnKeys(owner, communityId, {
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
    });
    const cloud = createHarness(probe.db);
    await expect(
      cloud.service.connectStripe(owner, communityId, { acceptCreatorTerms: true }),
    ).rejects.toThrow(AlreadyConnectedError);
  });
});
