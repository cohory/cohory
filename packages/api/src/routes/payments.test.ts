import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { newId } from "@cohory/db";
import {
  CompAlreadyGrantedError,
  CreatorTermsRequiredError,
  CurrencyLockedError,
  EmailNotConfirmedError,
  ExitInProgressError,
  LiveKeyRefusedError,
  PaidSignupsPausedError,
  PaymentAccountReviewRequiredError,
  ProviderDisabledError,
  PaymentsUnavailableError,
  PaymentsValidationError,
  type PaymentsService,
  type PlanView,
} from "@cohory/payments";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

type Stub = { [K in keyof PaymentsService]: Mock<PaymentsService[K]> };

function createStub(): Stub {
  return {
    getPaymentsOverview: vi.fn<PaymentsService["getPaymentsOverview"]>(),
    connectStripe: vi.fn<PaymentsService["connectStripe"]>(),
    connectOwnKeys: vi.fn<PaymentsService["connectOwnKeys"]>(),
    refreshConnection: vi.fn<PaymentsService["refreshConnection"]>(),
    acceptCreatorTerms: vi.fn<PaymentsService["acceptCreatorTerms"]>(),
    creatorTermsAccepted: vi.fn<PaymentsService["creatorTermsAccepted"]>(),
    disconnectStripe: vi.fn<PaymentsService["disconnectStripe"]>(),
    removeApplicationFees: vi.fn<PaymentsService["removeApplicationFees"]>(),
    getPlan: vi.fn<PaymentsService["getPlan"]>(),
    getDraftPlan: vi.fn<PaymentsService["getDraftPlan"]>(),
    upsertPlan: vi.fn<PaymentsService["upsertPlan"]>(),
    archivePlan: vi.fn<PaymentsService["archivePlan"]>(),
    createCheckoutSession: vi.fn<PaymentsService["createCheckoutSession"]>(),
    createPortalSession: vi.fn<PaymentsService["createPortalSession"]>(),
    rejoinWithPaidAccess: vi.fn<PaymentsService["rejoinWithPaidAccess"]>(),
    getMyMembership: vi.fn<PaymentsService["getMyMembership"]>(),
    getMembershipAccess: vi.fn<PaymentsService["getMembershipAccess"]>(),
    hasActiveMembership: vi.fn<PaymentsService["hasActiveMembership"]>(),
    listSubscriptions: vi.fn<PaymentsService["listSubscriptions"]>(),
    getLedgerSummary: vi.fn<PaymentsService["getLedgerSummary"]>(),
    getRevenueMetrics: vi.fn<PaymentsService["getRevenueMetrics"]>(),
    handleWebhook: vi.fn<PaymentsService["handleWebhook"]>(),
    grantComp: vi.fn<PaymentsService["grantComp"]>(),
    revokeComp: vi.fn<PaymentsService["revokeComp"]>(),
    listComps: vi.fn<PaymentsService["listComps"]>(),
    listCompInvitations: vi.fn<PaymentsService["listCompInvitations"]>(),
    withdrawCompInvitation: vi.fn<PaymentsService["withdrawCompInvitation"]>(),
    listMyCompInvitations: vi.fn<PaymentsService["listMyCompInvitations"]>(),
    acceptCompInvitation: vi.fn<PaymentsService["acceptCompInvitation"]>(),
    expireComps: vi.fn<PaymentsService["expireComps"]>(),
    getCancelOverview: vi.fn<PaymentsService["getCancelOverview"]>(),
    cancelMembership: vi.fn<PaymentsService["cancelMembership"]>(),
    switchToYearly: vi.fn<PaymentsService["switchToYearly"]>(),
    pauseMembership: vi.fn<PaymentsService["pauseMembership"]>(),
    resumeMembership: vi.fn<PaymentsService["resumeMembership"]>(),
    expireMembershipHolds: vi.fn<PaymentsService["expireMembershipHolds"]>(),
    queueRenewalReminders: vi.fn<PaymentsService["queueRenewalReminders"]>(),
    prepareRenewalReminder: vi.fn<PaymentsService["prepareRenewalReminder"]>(),
    releaseBillingForUser: vi.fn<PaymentsService["releaseBillingForUser"]>(),
    listSubscriberTenure: vi.fn<PaymentsService["listSubscriberTenure"]>(),
    discoverSubscriptions: vi.fn<PaymentsService["discoverSubscriptions"]>(),
    linkSubscriptions: vi.fn<PaymentsService["linkSubscriptions"]>(),
    listSubscriptionLinks: vi.fn<PaymentsService["listSubscriptionLinks"]>(),
    listSubscriberMoves: vi.fn<PaymentsService["listSubscriberMoves"]>(),
    addSubscriberMoves: vi.fn<PaymentsService["addSubscriberMoves"]>(),
    claimMoveReminders: vi.fn<PaymentsService["claimMoveReminders"]>(),
    sweepSubscriberMoves: vi.fn<PaymentsService["sweepSubscriberMoves"]>(),
    claimInvitedSubscriptions: vi.fn<PaymentsService["claimInvitedSubscriptions"]>(),
    processWebhookEvent: vi.fn<PaymentsService["processWebhookEvent"]>(),
    scheduleConnectionReconciles: vi.fn<PaymentsService["scheduleConnectionReconciles"]>(),
    reconcileConnection: vi.fn<PaymentsService["reconcileConnection"]>(),
    sweepWebhookEvents: vi.fn<PaymentsService["sweepWebhookEvents"]>(),
    replayWebhookEvent: vi.fn<PaymentsService["replayWebhookEvent"]>(),
    connectProvider: vi.fn<PaymentsService["connectProvider"]>(),
    saveProviderWebhookSecret: vi.fn<PaymentsService["saveProviderWebhookSecret"]>(),
    sendTestWebhook: vi.fn<PaymentsService["sendTestWebhook"]>(),
    getPaidMembersSummary: vi.fn<PaymentsService["getPaidMembersSummary"]>(),
    runExitRun: vi.fn<PaymentsService["runExitRun"]>(),
    retryExitRun: vi.fn<PaymentsService["retryExitRun"]>(),
    beginArchive: vi.fn<PaymentsService["beginArchive"]>(),
    beginDeletion: vi.fn<PaymentsService["beginDeletion"]>(),
    deletionReady: vi.fn<PaymentsService["deletionReady"]>(),
    forceDisconnect: vi.fn<PaymentsService["forceDisconnect"]>(),
    getOwnershipReview: vi.fn<PaymentsService["getOwnershipReview"]>(),
    keepPaymentAccount: vi.fn<PaymentsService["keepPaymentAccount"]>(),
    endClosedBillingAccess: vi.fn<PaymentsService["endClosedBillingAccess"]>(),
    getMemberBilling: vi.fn<PaymentsService["getMemberBilling"]>(),
    listMemberAccess: vi.fn<PaymentsService["listMemberAccess"]>(),
    endBillingForRemovedMember: vi.fn<PaymentsService["endBillingForRemovedMember"]>(),
    requestBillingEndForRemovedMember:
      vi.fn<PaymentsService["requestBillingEndForRemovedMember"]>(),
  };
}

const at = new Date("2026-10-18T10:00:00.000Z");
const plan: PlanView = {
  id: newId(),
  name: "Membership",
  currency: "usd",
  monthlyPriceMinor: 4900,
  annualPriceMinor: null,
  purchasable: true,
  providerName: "Stripe",
  archivedAt: null,
  createdAt: at,
};

let stub: Stub;
let api: ReturnType<typeof createApi>;
const communityId = newId();
const userId = newId();

beforeEach(() => {
  stub = createStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(createFakeRepository()),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      payments: stub,
    }),
  );
});

async function call(
  path: string,
  init: { method?: string; signedIn?: boolean; body?: unknown; rawBody?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.signedIn ?? true) headers.set(sessionHeader, userId);
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/${communityId}/payments${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

async function error(
  response: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
  return (
    (await response.json()) as { error: { code: string; message: string; details?: unknown } }
  ).error;
}

describe("payments routes", () => {
  it("returns the public plan to signed out visitors", async () => {
    stub.getPlan.mockResolvedValue(plan);

    const response = await call("/plan", { signedIn: false });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plan: { ...plan, createdAt: at.toISOString(), archivedAt: null },
    });
    expect(stub.getPlan.mock.calls[0]?.[0]).toEqual({ kind: "guest" });
    expect(stub.getPlan.mock.calls[0]?.[1]).toBe(communityId);
  });

  it("passes the plan body to the service as integers in minor units", async () => {
    stub.upsertPlan.mockResolvedValue(plan);

    const response = await call("/plan", {
      method: "PUT",
      body: { currency: "USD", monthlyPriceMinor: 4900, annualPriceMinor: null },
    });

    expect(response.status).toBe(200);
    expect(stub.upsertPlan.mock.calls[0]?.[2]).toEqual({
      currency: "USD",
      monthlyPriceMinor: 4900,
      annualPriceMinor: null,
    });
  });

  it("rejects fractional prices before the service", async () => {
    const response = await call("/plan", {
      method: "PUT",
      body: { currency: "usd", monthlyPriceMinor: 49.5 },
    });

    expect(response.status).toBe(422);
    expect(stub.upsertPlan).not.toHaveBeenCalled();
  });

  it("starts checkout with an optional interval and returns the Stripe URL", async () => {
    stub.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1" });

    const empty = await call("/checkout", { method: "POST" });
    const yearly = await call("/checkout", { method: "POST", body: { interval: "year" } });
    const invalid = await call("/checkout", { method: "POST", body: { interval: "week" } });

    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(stub.createCheckoutSession.mock.calls[0]?.[2]).toEqual({});
    expect(yearly.status).toBe(200);
    expect(stub.createCheckoutSession.mock.calls[1]?.[2]).toEqual({ interval: "year" });
    expect(invalid.status).toBe(422);
  });

  it("answers 409 paid_signups_paused while the platform invoice is past due", async () => {
    stub.createCheckoutSession.mockRejectedValue(new PaidSignupsPausedError());

    const paused = await call("/checkout", { method: "POST" });

    expect(paused.status).toBe(409);
    expect(await error(paused)).toMatchObject({
      code: "paid_signups_paused",
      message: "New memberships are paused in this community for now. Try again later.",
    });
  });

  it("answers 409 provider_disabled for a checkout on Polar while Polar is off", async () => {
    stub.createCheckoutSession.mockRejectedValue(new ProviderDisabledError("polar"));

    const refused = await call("/checkout", { method: "POST" });

    expect(refused.status).toBe(409);
    expect(await error(refused)).toMatchObject({
      code: "provider_disabled",
      message: "Polar is not available on this server. Connect Stripe instead.",
    });
  });

  it("tells the owner when the open connection is a retired Polar connection", async () => {
    stub.getPaymentsOverview.mockResolvedValue({
      edition: "cloud",
      platformFeeBps: 200,
      providers: ["stripe_connect"],
      connection: null,
      polarRetired: true,
    });

    const response = await call("");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: ["stripe_connect"],
      polarRetired: true,
    });
  });

  it("maps domain errors to plain language responses", async () => {
    stub.upsertPlan.mockRejectedValue(new CurrencyLockedError());
    stub.getLedgerSummary.mockRejectedValue(new ForbiddenError("read", "payment"));
    stub.connectStripe.mockRejectedValue(new PaymentsUnavailableError("STRIPE_SECRET_KEY"));
    stub.connectOwnKeys.mockRejectedValue(new LiveKeyRefusedError());
    stub.refreshConnection.mockRejectedValue(
      new PaymentsValidationError([{ path: "x", message: "bad" }]),
    );

    const locked = await call("/plan", {
      method: "PUT",
      body: { currency: "eur", monthlyPriceMinor: 100 },
    });
    const forbidden = await call("/ledger");
    const unavailable = await call("/connect", { method: "POST" });
    const live = await call("/own-keys", {
      method: "POST",
      body: { secretKey: "sk_live_1", webhookSecret: "whsec_1" },
    });
    const invalid = await call("/refresh", { method: "POST" });

    expect(locked.status).toBe(409);
    expect(await error(locked)).toMatchObject({ code: "currency_locked" });
    expect(forbidden.status).toBe(403);
    expect(unavailable.status).toBe(503);
    expect((await error(unavailable)).message).not.toContain("STRIPE_SECRET_KEY");
    expect(live.status).toBe(422);
    expect(invalid.status).toBe(422);
  });

  it("refuses to connect a payment account until the creator confirms their email", async () => {
    stub.connectStripe.mockRejectedValue(new EmailNotConfirmedError());
    stub.connectOwnKeys.mockRejectedValue(new EmailNotConfirmedError());

    const connect = await call("/connect", { method: "POST" });
    const ownKeys = await call("/own-keys", {
      method: "POST",
      body: { secretKey: "rk_test_1", webhookSecret: "whsec_1" },
    });

    for (const response of [connect, ownKeys]) {
      expect(response.status).toBe(403);
      expect(await error(response)).toMatchObject({
        code: "email_not_confirmed",
        message: "Confirm your email before you connect a payment account.",
      });
    }
  });

  it("asks the creator to accept the Creator Terms before connecting Stripe", async () => {
    stub.connectStripe.mockRejectedValue(new CreatorTermsRequiredError());

    const response = await call("/connect", { method: "POST" });

    expect(response.status).toBe(403);
    expect(await error(response)).toMatchObject({
      code: "creator_terms_required",
      message:
        "Accept the Creator Terms and the Data Processing Agreement before you connect Stripe.",
    });
  });

  it("passes the Creator Terms acceptance to the service and never a version from the caller", async () => {
    stub.connectStripe.mockRejectedValue(new CreatorTermsRequiredError());

    await call("/connect", {
      method: "POST",
      body: { acceptCreatorTerms: true, creatorTermsVersion: "0" },
    });
    await call("/connect", { method: "POST" });

    expect(stub.connectStripe.mock.calls[0]?.[2]).toEqual({
      email: null,
      country: null,
      acceptCreatorTerms: true,
    });
    expect(stub.connectStripe.mock.calls[1]?.[2]).toEqual({
      email: null,
      country: null,
      acceptCreatorTerms: false,
    });
  });

  it("passes the disconnect choice and portal link to the service", async () => {
    const closing = {
      id: newId(),
      provider: "stripe_connect" as const,
      providerName: "Stripe",
      status: "disconnecting" as const,
      externalAccountId: "acct_1",
      chargesEnabled: true,
      detailsSubmitted: true,
      livemode: false,
      webhookPath: null,
      webhookSecretSaved: false,
      lastWebhookAt: null,
      feeSplit: true,
      customerPortal: true,
      createdAt: at,
      updatedAt: at,
    };
    stub.disconnectStripe.mockResolvedValue(closing);

    const empty = await call("/disconnect", { method: "POST" });
    const chosen = await call("/disconnect", {
      method: "POST",
      body: {
        memberChoice: "wind_down",
        includeLinked: false,
        portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
      },
    });

    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ status: "disconnecting" });
    expect(stub.disconnectStripe.mock.calls[0]?.[2]).toEqual({});
    expect(chosen.status).toBe(200);
    expect(stub.disconnectStripe.mock.calls[1]?.[2]).toEqual({
      memberChoice: "wind_down",
      includeLinked: false,
      portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
    });
  });

  it("rejects a portal link that is not Stripe's before the service", async () => {
    const response = await call("/disconnect", {
      method: "POST",
      body: { portalLoginUrl: "https://billing.stripe.com.evil.test/p/login/x" },
    });

    expect(response.status).toBe(422);
    expect(stub.disconnectStripe).not.toHaveBeenCalled();
  });

  it("disconnects anyway and retries the latest run for the owner", async () => {
    stub.forceDisconnect.mockRejectedValue(new ExitInProgressError());
    stub.retryExitRun.mockResolvedValue({
      id: "01900000-0000-7000-8000-0000000000e1",
      kind: "disconnect",
      choice: "take_members",
      status: "done",
      includeLinked: true,
      targetCount: 1,
      doneCount: 1,
      failedCount: 0,
      failedMembers: [],
      createdAt: at,
      finishedAt: at,
    });

    const forced = await call("/disconnect/force", { method: "POST" });
    const retried = await call("/exit/retry", { method: "POST" });

    expect(forced.status).toBe(409);
    expect((await error(forced)).code).toBe("exit_in_progress");
    expect(stub.forceDisconnect.mock.calls[0]?.[1]).toBe(communityId);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      kind: "disconnect",
      status: "done",
      createdAt: at.toISOString(),
    });
  });

  it("returns the ownership review and keeps the account for the new owner", async () => {
    stub.getOwnershipReview.mockResolvedValueOnce({
      previousOwnerName: "Ada",
      provider: "stripe_connect",
      cohory: 2,
      linkedImports: 1,
    });
    stub.getOwnershipReview.mockResolvedValueOnce(null);
    stub.keepPaymentAccount.mockRejectedValue(new PaymentAccountReviewRequiredError());

    const pending = await call("/ownership-review");
    const settled = await call("/ownership-review");
    const kept = await call("/keep-account", { method: "POST" });

    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({
      review: { previousOwnerName: "Ada", provider: "stripe_connect", cohory: 2, linkedImports: 1 },
    });
    expect(await settled.json()).toEqual({ review: null });
    expect(kept.status).toBe(409);
    expect((await error(kept)).code).toBe("payment_account_review_required");
    expect(stub.keepPaymentAccount.mock.calls[0]?.[1]).toBe(communityId);
  });

  it("serializes the paid members summary with the latest run", async () => {
    stub.getPaidMembersSummary.mockResolvedValue({
      connection: "open",
      cohory: 3,
      linkedImports: 1,
      endingAtPeriodEnd: 2,
      manualCancellation: 1,
      run: {
        id: "01900000-0000-7000-8000-0000000000e1",
        kind: "archive",
        choice: "stop_at_period_end",
        status: "failed",
        includeLinked: true,
        targetCount: 4,
        doneCount: 3,
        failedCount: 1,
        failedMembers: [{ userId: "01900000-0000-7000-8000-0000000000e2", name: "Ada" }],
        createdAt: at,
        finishedAt: at,
      },
    });

    const response = await call("/paid-members");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connection: "open",
      cohory: 3,
      linkedImports: 1,
      endingAtPeriodEnd: 2,
      manualCancellation: 1,
      run: { status: "failed", failedCount: 1, createdAt: at.toISOString() },
    });
  });

  it("serializes the caller's membership access with ISO dates", async () => {
    stub.getMyMembership.mockResolvedValue({
      access: {
        level: "member",
        source: "subscription",
        state: "grace",
        currentPeriodEnd: at,
        cancelAtPeriodEnd: false,
      },
      plan,
      subscription: null,
      canManageBilling: true,
      resubscribe: null,
      provider: { id: "stripe_connect", name: "Stripe", customerPortal: true },
      communityArchived: false,
      canRejoin: false,
      inviteRequired: false,
      asksJoinQuestions: false,
      supportContact: null,
      price: null,
      yearly: null,
      suggestYearly: false,
      paused: false,
    });

    const response = await call("/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: { level: "member", state: "grace", currentPeriodEnd: at.toISOString() },
      canManageBilling: true,
    });
  });

  it("tells a member whose paid access ended after a disconnect whom to contact", async () => {
    stub.getMyMembership.mockResolvedValue({
      access: { level: "payment_required", reason: "billing_closed" },
      plan: null,
      subscription: null,
      canManageBilling: false,
      resubscribe: null,
      provider: null,
      communityArchived: false,
      canRejoin: false,
      inviteRequired: false,
      asksJoinQuestions: false,
      supportContact: "owner@example.test",
      price: null,
      yearly: null,
      suggestYearly: false,
      paused: false,
    });

    const response = await call("/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: { level: "payment_required", reason: "billing_closed" },
      supportContact: "owner@example.test",
    });
  });

  it("returns 204 when the plan is archived", async () => {
    stub.archivePlan.mockResolvedValue();
    const response = await call("/plan", { method: "DELETE" });
    expect(response.status).toBe(204);
  });
});

describe("comped access routes", () => {
  const comp = {
    id: newId(),
    userId: newId(),
    note: null,
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    createdAt: at,
    status: "active" as const,
  };

  it("grants by email with an end date and answers 201", async () => {
    stub.grantComp.mockResolvedValue({ kind: "granted", comp });

    const response = await call("/comps", {
      method: "POST",
      body: { email: "guest@example.test", expiresAt: "2026-12-01T00:00:00.000Z" },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ expiresAt: "2026-12-01T00:00:00.000Z" });
    expect(stub.grantComp).toHaveBeenCalledWith(expect.anything(), communityId, {
      email: "guest@example.test",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
  });

  it("answers 202 with the invitation when the grant becomes an invitation", async () => {
    const invitation = {
      id: newId(),
      email: "guest@example.test",
      note: null,
      expiresAt: null,
      createdAt: at,
    };
    stub.grantComp.mockResolvedValue({ kind: "invited", invitation });
    stub.listCompInvitations.mockResolvedValue([{ ...invitation, grantedByName: "Owner" }]);
    stub.withdrawCompInvitation.mockResolvedValue({ ...invitation, grantedByName: null });

    const granted = await call("/comps", { method: "POST", body: { email: "guest@example.test" } });
    const list = await call("/comps/invitations");
    const withdrawn = await call(`/comps/invitations/${invitation.id}`, { method: "DELETE" });

    expect(granted.status).toBe(202);
    expect(await granted.json()).toEqual({
      id: invitation.id,
      email: "guest@example.test",
      note: null,
      expiresAt: null,
      createdAt: at.toISOString(),
    });
    expect(await list.json()).toMatchObject({
      data: [{ id: invitation.id, grantedByName: "Owner" }],
    });
    expect(withdrawn.status).toBe(200);
    expect(stub.withdrawCompInvitation).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      invitation.id,
    );
  });

  it("lists and revokes, mapping a duplicate grant to 409", async () => {
    stub.listComps.mockResolvedValue([
      { ...comp, userName: "Guest", userEmail: "guest@example.test", grantedByName: "Owner" },
    ]);
    stub.revokeComp.mockResolvedValue({ ...comp, status: "revoked" });
    stub.grantComp.mockRejectedValue(new CompAlreadyGrantedError());

    const list = await call("/comps");
    const revoke = await call(`/comps/${comp.id}`, { method: "DELETE" });
    const duplicate = await call("/comps", { method: "POST", body: { userId: comp.userId } });

    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);
    expect(await revoke.json()).toMatchObject({ status: "revoked" });
    expect(duplicate.status).toBe(409);
    expect((await error(duplicate)).code).toBe("comp_exists");
  });
});

describe("comped access offers for the invited person", () => {
  const invitationId = newId();

  it("lists the caller's pending offers and accepts one through the payments service", async () => {
    stub.listMyCompInvitations.mockResolvedValue({
      invitations: [{ id: invitationId, expiresAt: new Date("2026-12-01T00:00:00.000Z") }],
      waitingForVerification: false,
    });
    stub.acceptCompInvitation.mockResolvedValue({
      id: newId(),
      userId,
      note: "Speaker",
      expiresAt: null,
      createdAt: at,
      status: "active",
    });

    const list = await call("/comps/offers");
    const accepted = await call(`/comps/offers/${invitationId}/accept`, { method: "POST" });

    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [{ id: invitationId, expiresAt: "2026-12-01T00:00:00.000Z" }],
      nextCursor: null,
      waitingForVerification: false,
    });
    expect(stub.listMyCompInvitations).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ userId, status: "active", note: "Speaker" });
    expect(stub.acceptCompInvitation).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
      invitationId,
    );
  });

  it("needs a session and maps the service refusals", async () => {
    stub.listMyCompInvitations.mockRejectedValue(new UnauthenticatedError());
    stub.acceptCompInvitation.mockRejectedValueOnce(
      new ForbiddenError("accept_comp", "membership"),
    );
    stub.acceptCompInvitation.mockRejectedValueOnce(new CompAlreadyGrantedError());

    const signedOut = await call("/comps/offers", { signedIn: false });
    const banned = await call(`/comps/offers/${invitationId}/accept`, { method: "POST" });
    const duplicate = await call(`/comps/offers/${invitationId}/accept`, { method: "POST" });
    const malformed = await call("/comps/offers/not-an-id/accept", { method: "POST" });

    expect(signedOut.status).toBe(401);
    expect(banned.status).toBe(403);
    expect(duplicate.status).toBe(409);
    expect(malformed.status).toBe(422);
    expect(stub.acceptCompInvitation).toHaveBeenCalledTimes(2);
  });
});

describe("payments OpenAPI document", () => {
  const base = "/api/v1/communities/{communityId}/payments";

  it.each([
    [base, "get", "getPaymentsOverview"],
    [`${base}/connect`, "post", "connectStripe"],
    [`${base}/own-keys`, "post", "connectOwnStripeKeys"],
    [`${base}/refresh`, "post", "refreshPaymentConnection"],
    [`${base}/disconnect`, "post", "disconnectStripe"],
    [`${base}/disconnect/force`, "post", "forceDisconnectStripe"],
    [`${base}/exit/retry`, "post", "retryPaidMembersChange"],
    [`${base}/plan`, "get", "getMembershipPlan"],
    [`${base}/plan`, "put", "upsertMembershipPlan"],
    [`${base}/plan`, "delete", "archiveMembershipPlan"],
    [`${base}/checkout`, "post", "createMembershipCheckout"],
    [`${base}/portal`, "post", "createBillingPortalSession"],
    [`${base}/me`, "get", "getMyPaidMembership"],
    [`${base}/subscriptions`, "get", "listSubscriptions"],
    [`${base}/ledger`, "get", "getPaymentsLedgerSummary"],
    [`${base}/paid-members`, "get", "getPaidMembersSummary"],
    [`${base}/ownership-review`, "get", "getPaymentOwnershipReview"],
    [`${base}/keep-account`, "post", "keepPaymentAccount"],
    [`${base}/comps/offers`, "get", "listMyCompOffers"],
    [`${base}/comps/offers/{invitationId}/accept`, "post", "acceptCompOffer"],
  ] as const)("documents %s %s as %s", (path, method, operationId) => {
    const operation = createOpenApiDocument(api).paths?.[path]?.[method];

    expect(operation?.operationId).toBe(operationId);
    expect(operation?.security).toEqual([{ sessionCookie: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(["401", "403", "404", "422"]),
    );
  });
});
