import { getPlatformConfig } from "@cohory/config/platform";
import {
  DeletionBlockedByBillingError,
  LiveKeyRefusedError,
  ManualCancellationRequiredError,
  PaymentsError,
  PaymentsNotFoundError,
  ProviderRejectedError,
  type PaymentsErrorCode,
} from "@cohory/payments";

import { fromCatalog, fromClass } from "./match";
import type { Catalog, ErrorMatcher } from "./types";

const notForSale = "Memberships are not for sale right now. Try again later.";

export const liveKeyMessage =
  "Live keys only work on a production server. Use a test key (sk_test_).";

function providerRejected(error: PaymentsError): string {
  const name = error instanceof ProviderRejectedError ? error.providerName : "The payment provider";
  return `${name} could not complete that request. Try again in a minute.`;
}

export const paymentsCatalog = {
  not_found: {
    kind: "not_found",
    message: (error) =>
      error instanceof PaymentsNotFoundError && error.subject === "person"
        ? "No account uses that email address. Ask them to sign up first."
        : "We could not find that community or plan.",
  },
  payments_unavailable: {
    kind: "unavailable",
    message:
      "Payments are not set up on this server yet. Ask the operator to add the Stripe settings.",
    member: notForSale,
  },
  edition_mismatch: {
    kind: "conflict",
    message: "This payment option is not available on this server.",
  },
  already_connected: {
    kind: "conflict",
    message: "This community already has a payment account connected.",
  },
  not_connected: {
    kind: "conflict",
    message: "Connect a Stripe account that can take payments first.",
    member: notForSale,
  },
  plan_unavailable: {
    kind: "conflict",
    message: "This community has no paid membership for sale.",
    member: notForSale,
  },
  interval_unavailable: {
    kind: "validation",
    message: "This plan has no annual price. Choose monthly.",
  },
  currency_locked: {
    kind: "conflict",
    message: "Stop selling the current plan before you change the currency.",
  },
  already_subscribed: {
    kind: "conflict",
    message: "You already have an active membership in this community.",
  },
  no_billing_account: {
    kind: "not_found",
    message: "There is no billing account for you in this community yet.",
  },
  stripe_rejected: {
    kind: "conflict",
    message: "Stripe could not complete that request. Try again in a minute.",
  },
  paid_signups_paused: {
    kind: "conflict",
    message: "New memberships are paused in this community for now. Try again later.",
    creator:
      "New paid signups are paused until the platform invoice is paid. Existing members keep access.",
  },
  provider_rejected: {
    kind: "conflict",
    message: (error) =>
      error instanceof ProviderRejectedError && (error.status === 401 || error.status === 403)
        ? `${error.providerName} refused the access token. Check that it is current and has the scopes it needs.`
        : providerRejected(error),
    member: providerRejected,
  },
  fee_removal_incomplete: {
    kind: "conflict",
    message: "Some subscriptions still carry the platform fee. The removal job retries.",
  },
  comp_exists: { kind: "conflict", message: "This person already has free access." },
  exit_in_progress: {
    kind: "conflict",
    message: "Another change to paid members is still running. Wait for it to finish.",
  },
  community_archived: {
    kind: "conflict",
    message: "This community is archived, so new memberships are closed.",
  },
  invalid_exit_choice: {
    kind: "validation",
    message: "That choice is not available for this change to paid members.",
  },
  provider_disabled: {
    kind: "conflict",
    message: "Polar is not available on this server. Connect Stripe instead.",
    member: notForSale,
  },
  deletion_blocked_billing: {
    kind: "conflict",
    message: (error) =>
      error instanceof DeletionBlockedByBillingError
        ? error.message
        : `Pay the open ${getPlatformConfig().instance.name} invoice before deleting this community.`,
    details: (error) =>
      error instanceof DeletionBlockedByBillingError ? { reason: error.reason } : undefined,
  },
  manual_cancellation_required: {
    kind: "conflict",
    message: (error) => {
      const count = error instanceof ManualCancellationRequiredError ? error.count : 2;
      return `Cancel ${count === 1 ? "this subscription" : `these ${count} subscriptions`} in your Stripe Dashboard, then confirm.`;
    },
    details: (error) =>
      error instanceof ManualCancellationRequiredError ? { count: error.count } : undefined,
  },
  email_not_confirmed: {
    kind: "forbidden",
    message: "Confirm your email before you connect a payment account.",
  },
  creator_terms_required: {
    kind: "forbidden",
    message:
      "Accept the Creator Terms and the Data Processing Agreement before you connect Stripe.",
  },
  payment_account_review_required: {
    kind: "conflict",
    message:
      "Choose whether to keep the previous owner's Stripe account before you connect your own.",
  },
  invite_required: {
    kind: "forbidden",
    message: "This community is invite only. Ask a member for an invite link.",
  },
  plan_conflict: {
    kind: "conflict",
    message: "The pricing changed while it was being saved. Reload the page and try again.",
  },
  membership_change_unavailable: {
    kind: "conflict",
    message: "That change isn't available for your membership right now. Reload the page.",
  },
} satisfies Catalog<Exclude<PaymentsErrorCode, "validation_failed">, PaymentsError>;

export const paymentsMatchers: readonly ErrorMatcher[] = [
  fromClass(LiveKeyRefusedError, "validation_failed", {
    kind: "validation",
    message: liveKeyMessage,
    issues: () => [{ path: "secretKey", message: liveKeyMessage }],
  }),
  fromCatalog(PaymentsError, paymentsCatalog),
];
