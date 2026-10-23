import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { newId } from "@cohory/db";
import {
  NotConnectedError,
  PaymentsNotFoundError,
  type DiscoveredSubscriber,
  type PaymentsService,
  type SubscriptionLinkView,
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
const memberId = newId();
const communityId = newId();
const userId = newId();

const discovered: DiscoveredSubscriber = {
  subscriptionId: "sub_1",
  customerId: "cus_1",
  email: "ada@example.test",
  customerName: "Ada",
  status: "active",
  priceId: "price_1",
  unitAmountMinor: 4900,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  currentPeriodEnd: at,
  cancelAtPeriodEnd: false,
  match: { kind: "member", userId: memberId, name: "Ada" },
  block: null,
  proposed: "link_member",
  allowed: ["link_member", "skip"],
  suggestedInterval: "month",
};

const linkView: SubscriptionLinkView = {
  id: newId(),
  externalSubscriptionId: "sub_1",
  email: "ada@example.test",
  status: "invited",
  interval: "year",
  platformFeeBps: 0,
  linkedAt: null,
  createdAt: at,
};

let stub: Stub;
let api: ReturnType<typeof createApi>;

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
  init: { method?: string; signedIn?: boolean; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.signedIn ?? true) headers.set(sessionHeader, userId);
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  return api.request(`/api/v1/communities/${communityId}/payments/subscribers${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

async function error(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

describe("subscriber discovery route", () => {
  it("serializes the discovery with ISO dates and passes cursor and limit to the service", async () => {
    stub.discoverSubscriptions.mockResolvedValue({
      rows: [discovered],
      nextCursor: "sub_1",
      plan: {
        name: "Membership",
        currency: "usd",
        monthlyPriceMinor: 4900,
        annualPriceMinor: null,
      },
      edition: "cloud",
      platformFeeBps: 200,
      canAddPlatformFee: true,
    });

    const response = await call("?cursor=sub_0&limit=10");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ ...discovered, currentPeriodEnd: at.toISOString() }],
      nextCursor: "sub_1",
      plan: {
        name: "Membership",
        currency: "usd",
        monthlyPriceMinor: 4900,
        annualPriceMinor: null,
      },
      edition: "cloud",
      platformFeeBps: 200,
      canAddPlatformFee: true,
    });
    expect(stub.discoverSubscriptions).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
      { cursor: "sub_0", limit: 10 },
    );
  });

  it("passes no paging options when the query is empty", async () => {
    stub.discoverSubscriptions.mockResolvedValue({
      rows: [],
      nextCursor: null,
      plan: null,
      edition: "community",
      platformFeeBps: 0,
      canAddPlatformFee: false,
    });

    const response = await call("");

    expect(response.status).toBe(200);
    expect(stub.discoverSubscriptions.mock.calls[0]?.[2]).toEqual({});
  });

  it("rejects a cursor that is not a Stripe subscription id and a limit over 100", async () => {
    const cursor = await call("?cursor=cus_1");
    const limit = await call("?limit=101");

    expect(cursor.status).toBe(422);
    expect(limit.status).toBe(422);
    expect(stub.discoverSubscriptions).not.toHaveBeenCalled();
  });

  it("maps forbidden, missing, not connected, and signed out to their status codes", async () => {
    stub.discoverSubscriptions
      .mockRejectedValueOnce(new ForbiddenError("link_subscriptions", "payment"))
      .mockRejectedValueOnce(new PaymentsNotFoundError("community"))
      .mockRejectedValueOnce(new UnauthenticatedError());
    stub.listSubscriptionLinks.mockRejectedValue(new NotConnectedError());

    const forbidden = await call("");
    const missing = await call("");
    const notConnected = await call("/links");
    const signedOut = await call("", { signedIn: false });

    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(404);
    expect((await error(missing)).code).toBe("not_found");
    expect(notConnected.status).toBe(409);
    expect((await error(notConnected)).code).toBe("not_connected");
    expect(signedOut.status).toBe(401);
  });
});

describe("link subscribers route", () => {
  it("returns the outcome per row and the invited emails", async () => {
    stub.linkSubscriptions.mockResolvedValue({
      rows: [
        {
          subscriptionId: "sub_1",
          email: "ada@example.test",
          outcome: "linked",
          reason: null,
          platformFeeAdded: true,
        },
        {
          subscriptionId: "sub_2",
          email: "bob@example.test",
          outcome: "invited",
          reason: null,
          platformFeeAdded: false,
        },
        {
          subscriptionId: "sub_3",
          email: null,
          outcome: "refused",
          reason: "not_found",
          platformFeeAdded: false,
        },
      ],
      invitedEmails: ["bob@example.test"],
    });

    const response = await call("/link", {
      method: "POST",
      body: {
        rows: [
          { subscriptionId: "sub_1", action: "link_member", interval: "month" },
          { subscriptionId: "sub_2", action: "invite", interval: "year" },
          { subscriptionId: "sub_3", action: "skip" },
        ],
        addPlatformFee: true,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [
        { outcome: "linked" },
        { outcome: "invited" },
        { outcome: "refused", reason: "not_found" },
      ],
      invitedEmails: ["bob@example.test"],
    });
    expect(stub.linkSubscriptions).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
      {
        rows: [
          { subscriptionId: "sub_1", action: "link_member", interval: "month" },
          { subscriptionId: "sub_2", action: "invite", interval: "year" },
          { subscriptionId: "sub_3", action: "skip" },
        ],
        addPlatformFee: true,
      },
    );
  });

  it("leaves addPlatformFee to the service default when the body omits it", async () => {
    stub.linkSubscriptions.mockResolvedValue({ rows: [], invitedEmails: [] });

    await call("/link", {
      method: "POST",
      body: { rows: [{ subscriptionId: "sub_1", action: "skip" }] },
    });

    expect(stub.linkSubscriptions.mock.calls[0]?.[2]).toEqual({
      rows: [{ subscriptionId: "sub_1", action: "skip" }],
    });
  });

  it("answers 422 for an invalid body without calling the service", async () => {
    const empty = await call("/link", { method: "POST", body: { rows: [] } });
    const badId = await call("/link", {
      method: "POST",
      body: { rows: [{ subscriptionId: "cus_1", action: "skip" }] },
    });
    const noInterval = await call("/link", {
      method: "POST",
      body: { rows: [{ subscriptionId: "sub_1", action: "link_member" }] },
    });
    const badAction = await call("/link", {
      method: "POST",
      body: { rows: [{ subscriptionId: "sub_1", action: "delete", interval: "month" }] },
    });

    expect(empty.status).toBe(422);
    expect(badId.status).toBe(422);
    expect(noInterval.status).toBe(422);
    expect((await error(noInterval)).code).toBe("validation_failed");
    expect(badAction.status).toBe(422);
    expect(stub.linkSubscriptions).not.toHaveBeenCalled();
  });

  it("refuses members with 403", async () => {
    stub.linkSubscriptions.mockRejectedValue(new ForbiddenError("link_subscriptions", "payment"));

    const response = await call("/link", {
      method: "POST",
      body: { rows: [{ subscriptionId: "sub_1", action: "skip" }] },
    });

    expect(response.status).toBe(403);
  });
});

describe("subscription links route", () => {
  it("serializes the ledger with ISO dates", async () => {
    stub.listSubscriptionLinks.mockResolvedValue([
      linkView,
      { ...linkView, id: newId(), externalSubscriptionId: "sub_2", status: "linked", linkedAt: at },
    ]);

    const response = await call("/links");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { ...linkView, linkedAt: null, createdAt: at.toISOString() },
        expect.objectContaining({
          externalSubscriptionId: "sub_2",
          status: "linked",
          linkedAt: at.toISOString(),
        }),
      ],
      nextCursor: null,
    });
    expect(stub.listSubscriptionLinks).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
    );
  });
});

describe("subscriber linking OpenAPI document", () => {
  const base = "/api/v1/communities/{communityId}/payments/subscribers";

  it.each([
    [base, "get", "discoverSubscribers"],
    [`${base}/links`, "get", "listSubscriptionLinks"],
    [`${base}/link`, "post", "linkSubscribers"],
  ] as const)("documents %s %s as %s", (path, method, operationId) => {
    const operation = createOpenApiDocument(api).paths?.[path]?.[method];

    expect(operation?.operationId).toBe(operationId);
    expect(operation?.security).toEqual([{ sessionCookie: [] }]);
    expect(operation?.description).toMatch(/Admins and owners only\.$/);
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(["200", "401", "403", "404", "409", "422"]),
    );
  });
});
