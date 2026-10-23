import type * as CommunitiesModule from "@cohory/communities";
import { PaymentRequiredError } from "@cohory/communities";
import type * as PaymentsModule from "@cohory/payments";
import {
  AlreadySubscribedError,
  CreatorTermsRequiredError,
  EmailNotConfirmedError,
  NotConnectedError,
  PaymentAccountReviewRequiredError,
  PaymentsUnavailableError,
  type PaymentsService,
} from "@cohory/payments";
import { beforeEach, describe, expect, it, vi } from "vitest";

const payments = {
  createCheckoutSession: vi.fn<PaymentsService["createCheckoutSession"]>(),
  createPortalSession: vi.fn<PaymentsService["createPortalSession"]>(),
  connectStripe: vi.fn<PaymentsService["connectStripe"]>(),
  acceptCreatorTerms: vi.fn<PaymentsService["acceptCreatorTerms"]>(),
  upsertPlan: vi.fn<PaymentsService["upsertPlan"]>(),
  disconnectStripe: vi.fn<PaymentsService["disconnectStripe"]>(),
  forceDisconnect: vi.fn<PaymentsService["forceDisconnect"]>(),
  retryExitRun: vi.fn<PaymentsService["retryExitRun"]>(),
  keepPaymentAccount: vi.fn<PaymentsService["keepPaymentAccount"]>(),
  rejoinWithPaidAccess: vi.fn<PaymentsService["rejoinWithPaidAccess"]>(),
};

const communities = {
  getCommunityBySlug: vi.fn(),
  joinCommunity: vi.fn(),
};

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}

vi.mock("@cohory/payments", async (importOriginal) => ({
  ...(await importOriginal<typeof PaymentsModule>()),
  getPaymentsService: () => payments,
}));

vi.mock("@cohory/communities", async (importOriginal) => ({
  ...(await importOriginal<typeof CommunitiesModule>()),
  getCommunitiesService: () => communities,
}));

const session = { user: { id: "0192f0c0-0000-7000-8000-000000000001" } };

vi.mock("../session", () => ({
  currentSession: vi.fn(async () => session),
  requireCurrentSession: vi.fn(async () => session),
}));

vi.mock("@cohory/auth/next", () => ({
  getSession: vi.fn(async () => session),
  requireSession: vi.fn(async () => session),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
  notFound: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { joinCommunityAction } = await import("../../app/c/[slug]/actions");
const {
  connectStripeAction,
  acceptCreatorTermsAction,
  disconnectStripeAction,
  forceDisconnectAction,
  keepPaymentAccountAction,
  openBillingPortalAction,
  retryPaidMembersChangeAction,
  savePlanAction,
  startCheckoutAction,
} = await import("./actions");

const actor = { kind: "user", userId: session.user.id, platformAdmin: false };

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof RedirectSignal)) {
    throw new Error("expected a redirect");
  }
  return error.url;
}

beforeEach(() => {
  vi.clearAllMocks();
  communities.getCommunityBySlug.mockResolvedValue({ id: "community-1", slug: "demo" });
});

describe("startCheckoutAction", () => {
  it("redirects the member to the Checkout URL from the payments service", async () => {
    payments.createCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });

    const url = await redirectOf(startCheckoutAction({ slug: "demo", interval: "year" }));

    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(payments.createCheckoutSession).toHaveBeenCalledWith(actor, "community-1", {
      interval: "year",
      answers: [],
    });
  });

  it("answers with plain copy when memberships are not for sale", async () => {
    payments.createCheckoutSession.mockRejectedValue(new NotConnectedError());

    await expect(startCheckoutAction({ slug: "demo", interval: "month" })).resolves.toEqual({
      ok: false,
      message: "Memberships are not for sale right now. Try again later.",
    });
  });

  it("tells a member who already pays", async () => {
    payments.createCheckoutSession.mockRejectedValue(new AlreadySubscribedError());

    await expect(startCheckoutAction({ slug: "demo" })).resolves.toEqual({
      ok: false,
      message: "You already have an active membership in this community.",
    });
  });

  it("refuses an unknown billing interval before calling the service", async () => {
    const result = await startCheckoutAction({ slug: "demo", interval: "week" as "month" });

    expect(result.ok).toBe(false);
    expect(payments.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("never redirects to a URL that is not http or https", async () => {
    payments.createCheckoutSession.mockResolvedValue({ url: "javascript:alert(1)" });

    await expect(startCheckoutAction({ slug: "demo" })).rejects.toThrow();
  });
});

describe("openBillingPortalAction", () => {
  it("redirects to the customer portal", async () => {
    payments.createPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test_1",
    });

    await expect(redirectOf(openBillingPortalAction({ slug: "demo" }))).resolves.toBe(
      "https://billing.stripe.com/p/session/test_1",
    );
    expect(payments.createPortalSession.mock.calls.at(-1)?.[2]).toEqual({
      returnTo: "membership",
    });
  });

  it("asks Stripe to send the member back to /account/billing when opened from there", async () => {
    payments.createPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test_2",
    });

    await expect(
      redirectOf(openBillingPortalAction({ slug: "demo", returnTo: "account" })),
    ).resolves.toBe("https://billing.stripe.com/p/session/test_2");
    expect(payments.createPortalSession.mock.calls.at(-1)?.[2]).toEqual({ returnTo: "account" });
  });
});

describe("acceptCreatorTermsAction", () => {
  it("asks the service to record the Creator Terms version it is configured with", async () => {
    payments.acceptCreatorTerms.mockResolvedValue(undefined);

    await expect(acceptCreatorTermsAction({ slug: "demo" })).resolves.toEqual({
      ok: true,
      data: null,
    });

    expect(payments.acceptCreatorTerms).toHaveBeenCalledWith(actor, "community-1");
  });
});

describe("connectStripeAction", () => {
  it("passes the chosen country and the Creator Terms acceptance the person gave", async () => {
    payments.connectStripe.mockResolvedValue({
      url: "https://connect.stripe.com/setup/acct_1",
      connection: {} as Awaited<ReturnType<typeof payments.connectStripe>>["connection"],
    });

    await redirectOf(
      connectStripeAction({ slug: "demo", country: "DE", acceptCreatorTerms: true }),
    );

    expect(payments.connectStripe).toHaveBeenCalledWith(actor, "community-1", {
      country: "DE",
      acceptCreatorTerms: true,
    });
  });

  it("does not accept a newer Creator Terms version when the creator continues onboarding", async () => {
    payments.connectStripe.mockRejectedValue(new CreatorTermsRequiredError());

    await expect(connectStripeAction({ slug: "demo", acceptCreatorTerms: false })).resolves.toEqual(
      {
        ok: false,
        creatorTermsRequired: true,
        message: "Accept the updated Creator Terms before you continue with Stripe.",
      },
    );
    expect(payments.connectStripe).toHaveBeenCalledWith(actor, "community-1", {
      acceptCreatorTerms: false,
    });
  });

  it("never accepts the Creator Terms when the terms line was not shown", async () => {
    payments.connectStripe.mockRejectedValue(new CreatorTermsRequiredError());

    const result = await connectStripeAction({
      slug: "demo",
      country: "DE",
      acceptCreatorTerms: false,
    });

    expect(result).toMatchObject({ ok: false, creatorTermsRequired: true });
    expect(payments.connectStripe.mock.calls[0]?.[2]).toEqual({
      country: "DE",
      acceptCreatorTerms: false,
    });
  });

  it("explains that the creator must confirm their email before connecting", async () => {
    payments.connectStripe.mockRejectedValue(new EmailNotConfirmedError());

    await expect(connectStripeAction({ slug: "demo", acceptCreatorTerms: true })).resolves.toEqual({
      ok: false,
      message: "Confirm your email before you connect a payment account.",
    });
  });

  it("refuses a country that is not a two letter code", async () => {
    await expect(
      connectStripeAction({ slug: "demo", country: "Germany", acceptCreatorTerms: true }),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(payments.connectStripe).not.toHaveBeenCalled();
  });

  it("explains a server without Stripe settings to the creator", async () => {
    payments.connectStripe.mockRejectedValue(new PaymentsUnavailableError("STRIPE_SECRET_KEY"));

    await expect(connectStripeAction({ slug: "demo", acceptCreatorTerms: true })).resolves.toEqual({
      ok: false,
      message:
        "Payments are not set up on this server yet. Ask the operator to add the Stripe settings.",
    });
  });
});

describe("savePlanAction", () => {
  it("passes prices in minor units to the service", async () => {
    payments.upsertPlan.mockRejectedValue(new NotConnectedError());

    const result = await savePlanAction({
      slug: "demo",
      currency: "usd",
      monthlyPriceMinor: 2900,
      annualPriceMinor: null,
    });

    expect(payments.upsertPlan).toHaveBeenCalledWith(actor, "community-1", {
      currency: "usd",
      monthlyPriceMinor: 2900,
      annualPriceMinor: null,
    });
    expect(result).toEqual({
      ok: false,
      message: "Connect a Stripe account that can take payments first.",
    });
  });

  it("rejects fractional minor units", async () => {
    const result = await savePlanAction({
      slug: "demo",
      currency: "usd",
      monthlyPriceMinor: 29.5,
      annualPriceMinor: null,
    });

    expect(result.ok).toBe(false);
    expect(payments.upsertPlan).not.toHaveBeenCalled();
  });
});

describe("joinCommunityAction on a paid community", () => {
  it("sends the person to the membership page instead of failing", async () => {
    communities.joinCommunity.mockRejectedValue(new PaymentRequiredError());
    payments.rejoinWithPaidAccess.mockResolvedValue({ restored: false });

    await expect(redirectOf(joinCommunityAction("demo"))).resolves.toBe("/c/demo/membership");
  });

  it("lets a member who left come back without paying while their paid access lasts", async () => {
    communities.joinCommunity.mockRejectedValue(new PaymentRequiredError());
    payments.rejoinWithPaidAccess.mockResolvedValue({ restored: true });

    await expect(redirectOf(joinCommunityAction("demo"))).resolves.toBe("/c/demo");
    expect(payments.rejoinWithPaidAccess).toHaveBeenCalledWith(actor, "community-1");
    expect(payments.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("still joins a free community", async () => {
    communities.joinCommunity.mockResolvedValue({});

    await expect(redirectOf(joinCommunityAction("demo"))).resolves.toBe("/c/demo");
  });
});

describe("disconnect actions", () => {
  it("passes the member choice and the portal link to the payments service", async () => {
    payments.disconnectStripe.mockResolvedValue(
      {} as Awaited<ReturnType<PaymentsService["disconnectStripe"]>>,
    );

    const result = await disconnectStripeAction({
      slug: "demo",
      memberChoice: "wind_down",
      includeLinked: false,
      portalLoginUrl: " https://billing.stripe.com/p/login/test_abc ",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(payments.disconnectStripe).toHaveBeenCalledWith(actor, "community-1", {
      memberChoice: "wind_down",
      includeLinked: false,
      portalLoginUrl: "https://billing.stripe.com/p/login/test_abc",
    });
  });

  it("treats an empty portal link as none", async () => {
    payments.disconnectStripe.mockResolvedValue(
      {} as Awaited<ReturnType<PaymentsService["disconnectStripe"]>>,
    );

    await disconnectStripeAction({ slug: "demo", portalLoginUrl: "" });

    expect(payments.disconnectStripe).toHaveBeenCalledWith(actor, "community-1", {
      memberChoice: "take_members",
      includeLinked: true,
      portalLoginUrl: null,
    });
  });

  it("refuses a portal link that is not Stripe's before calling the service", async () => {
    const result = await disconnectStripeAction({
      slug: "demo",
      portalLoginUrl: "https://billing.stripe.com.evil.test/p/login/x",
    });

    expect(result).toEqual({
      ok: false,
      message: "Paste your Stripe customer portal link from billing.stripe.com",
    });
    expect(payments.disconnectStripe).not.toHaveBeenCalled();
  });

  it("disconnects anyway and retries through the payments service", async () => {
    payments.forceDisconnect.mockResolvedValue(
      {} as Awaited<ReturnType<PaymentsService["forceDisconnect"]>>,
    );
    payments.retryExitRun.mockResolvedValue(
      {} as Awaited<ReturnType<PaymentsService["retryExitRun"]>>,
    );

    expect(await forceDisconnectAction({ slug: "demo" })).toEqual({ ok: true, data: null });
    expect(await retryPaidMembersChangeAction({ slug: "demo" })).toEqual({ ok: true, data: null });
    expect(payments.forceDisconnect).toHaveBeenCalledWith(actor, "community-1");
    expect(payments.retryExitRun).toHaveBeenCalledWith(actor, "community-1");
  });
});

describe("keepPaymentAccountAction", () => {
  it("keeps the previous owner's account through the payments service", async () => {
    payments.keepPaymentAccount.mockResolvedValue(
      {} as Awaited<ReturnType<PaymentsService["keepPaymentAccount"]>>,
    );

    expect(await keepPaymentAccountAction({ slug: "demo" })).toEqual({ ok: true, data: null });
    expect(payments.keepPaymentAccount).toHaveBeenCalledWith(actor, "community-1");
  });

  it("asks the new owner to choose an account before connecting another one", async () => {
    payments.connectStripe.mockRejectedValue(new PaymentAccountReviewRequiredError());

    expect(await connectStripeAction({ slug: "demo", acceptCreatorTerms: true })).toEqual({
      ok: false,
      message:
        "Choose whether to keep the previous owner's Stripe account before you connect your own.",
    });
  });
});
