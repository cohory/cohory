import { getPlatformConfig } from "@cohory/config/platform";

import { capabilityRecord } from "./providers/capabilities";
import type { ProviderId } from "./providers/types";

export type PaymentsErrorCode =
  | "not_found"
  | "validation_failed"
  | "payments_unavailable"
  | "edition_mismatch"
  | "already_connected"
  | "not_connected"
  | "plan_unavailable"
  | "interval_unavailable"
  | "currency_locked"
  | "already_subscribed"
  | "no_billing_account"
  | "stripe_rejected"
  | "provider_rejected"
  | "paid_signups_paused"
  | "fee_removal_incomplete"
  | "comp_exists"
  | "exit_in_progress"
  | "invalid_exit_choice"
  | "community_archived"
  | "provider_disabled"
  | "deletion_blocked_billing"
  | "manual_cancellation_required"
  | "payment_account_review_required"
  | "invite_required"
  | "plan_conflict"
  | "email_not_confirmed"
  | "creator_terms_required"
  | "membership_change_unavailable";

export interface PaymentsValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class PaymentsError extends Error {
  abstract readonly code: PaymentsErrorCode;
}

export class PaymentsNotFoundError extends PaymentsError {
  readonly code = "not_found";

  constructor(
    readonly subject:
      "community" | "plan" | "connection" | "person" | "comp" | "exit_run" = "community",
  ) {
    super(`${subject} not found`);
    this.name = "PaymentsNotFoundError";
  }
}

export class PaymentsValidationError extends PaymentsError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly PaymentsValidationIssue[]) {
    super("payments input is invalid");
    this.name = "PaymentsValidationError";
  }
}

export class PaymentsUnavailableError extends PaymentsError {
  readonly code = "payments_unavailable";

  constructor(readonly missing: string) {
    super(`payments are not configured: ${missing}`);
    this.name = "PaymentsUnavailableError";
  }
}

export class EditionMismatchError extends PaymentsError {
  readonly code = "edition_mismatch";

  constructor(readonly requires: "cloud" | "community") {
    super(`this action needs the ${requires} edition`);
    this.name = "EditionMismatchError";
  }
}

export class AlreadyConnectedError extends PaymentsError {
  readonly code = "already_connected";

  constructor() {
    super("community already has a payment connection");
    this.name = "AlreadyConnectedError";
  }
}

export class NotConnectedError extends PaymentsError {
  readonly code = "not_connected";

  constructor() {
    super("community has no payment connection that can take payments");
    this.name = "NotConnectedError";
  }
}

export class PlanUnavailableError extends PaymentsError {
  readonly code = "plan_unavailable";

  constructor() {
    super("community has no paid plan for sale");
    this.name = "PlanUnavailableError";
  }
}

export class IntervalUnavailableError extends PaymentsError {
  readonly code = "interval_unavailable";

  constructor() {
    super("plan has no price for that interval");
    this.name = "IntervalUnavailableError";
  }
}

export class CurrencyLockedError extends PaymentsError {
  readonly code = "currency_locked";

  constructor() {
    super("archive the current plan before changing the currency");
    this.name = "CurrencyLockedError";
  }
}

export class MembershipChangeUnavailableError extends PaymentsError {
  readonly code = "membership_change_unavailable";

  constructor(readonly change: "cancel" | "pause" | "resume" | "switch_to_yearly") {
    super(`${change} is not available for this membership`);
    this.name = "MembershipChangeUnavailableError";
  }
}

export class AlreadySubscribedError extends PaymentsError {
  readonly code = "already_subscribed";

  constructor() {
    super("member already has an active subscription");
    this.name = "AlreadySubscribedError";
  }
}

export class NoBillingAccountError extends PaymentsError {
  readonly code = "no_billing_account";

  constructor() {
    super("member has no billing account in this community");
    this.name = "NoBillingAccountError";
  }
}

export class StripeRejectedError extends PaymentsError {
  readonly code = "stripe_rejected";

  constructor(readonly stripeCode: string | null) {
    super("Stripe rejected the request");
    this.name = "StripeRejectedError";
  }
}

export class PaidSignupsPausedError extends PaymentsError {
  readonly code = "paid_signups_paused";

  constructor() {
    super("new paid memberships are paused while the platform invoice is past due");
    this.name = "PaidSignupsPausedError";
  }
}

export class ProviderRejectedError extends PaymentsError {
  readonly code = "provider_rejected";

  constructor(
    readonly providerName: string,
    readonly status: number,
    readonly providerCode: string | null,
  ) {
    super(`${providerName} rejected the request with status ${status}`);
    this.name = "ProviderRejectedError";
  }
}

export class FeeRemovalIncompleteError extends PaymentsError {
  readonly code = "fee_removal_incomplete";

  constructor(
    readonly connectionId: string,
    readonly remaining: number,
  ) {
    super(`${remaining} subscriptions still carry the platform fee`);
    this.name = "FeeRemovalIncompleteError";
  }
}

export class CompAlreadyGrantedError extends PaymentsError {
  readonly code = "comp_exists";

  constructor() {
    super("person already has comped access");
    this.name = "CompAlreadyGrantedError";
  }
}

export class ExitInProgressError extends PaymentsError {
  readonly code = "exit_in_progress";

  constructor() {
    super("Another change to paid members is still running. Wait for it to finish.");
    this.name = "ExitInProgressError";
  }
}

export class ProviderDisabledError extends PaymentsError {
  readonly code = "provider_disabled";

  constructor(readonly provider: ProviderId) {
    super(
      `${capabilityRecord(provider)?.displayName ?? provider} is not available. Connect Stripe instead.`,
    );
    this.name = "ProviderDisabledError";
  }
}

export class InvalidExitChoiceError extends PaymentsError {
  readonly code = "invalid_exit_choice";

  constructor(
    readonly kind: string,
    readonly choice: string,
  ) {
    super(`${choice} is not a choice for ${kind}`);
    this.name = "InvalidExitChoiceError";
  }
}

export class CommunityArchivedCheckoutError extends PaymentsError {
  readonly code = "community_archived";

  constructor() {
    super("This community is archived, so new memberships are closed.");
    this.name = "CommunityArchivedCheckoutError";
  }
}

export type DeletionBillingBlock = "unpaid_invoice" | "open_balance";

export class DeletionBlockedByBillingError extends PaymentsError {
  readonly code = "deletion_blocked_billing";

  constructor(readonly reason: DeletionBillingBlock) {
    const instance = getPlatformConfig().instance.name;
    super(
      reason === "unpaid_invoice"
        ? `Pay the open ${instance} invoice before deleting this community.`
        : `This community owes ${instance} fees that are not invoiced yet. Pay the invoice at the end of the month, then delete the community.`,
    );
    this.name = "DeletionBlockedByBillingError";
  }
}

export class ManualCancellationRequiredError extends PaymentsError {
  readonly code = "manual_cancellation_required";

  constructor(readonly count: number) {
    super("Cancel these subscriptions in your Stripe Dashboard, then confirm.");
    this.name = "ManualCancellationRequiredError";
  }
}

export class EmailNotConfirmedError extends PaymentsError {
  readonly code = "email_not_confirmed";

  constructor() {
    super("Confirm your email before you connect a payment account.");
    this.name = "EmailNotConfirmedError";
  }
}

export class CreatorTermsRequiredError extends PaymentsError {
  readonly code = "creator_terms_required";

  constructor() {
    super("Accept the Creator Terms and the Data Processing Agreement before you connect Stripe.");
    this.name = "CreatorTermsRequiredError";
  }
}

export class PaymentAccountReviewRequiredError extends PaymentsError {
  readonly code = "payment_account_review_required";

  constructor() {
    super(
      "Choose whether to keep the previous owner's Stripe account before connecting a new one.",
    );
    this.name = "PaymentAccountReviewRequiredError";
  }
}

export class InviteRequiredError extends PaymentsError {
  readonly code = "invite_required";

  constructor() {
    super("This community is invite only. Join with an invite link first.");
    this.name = "InviteRequiredError";
  }
}

export class PlanConflictError extends PaymentsError {
  readonly code = "plan_conflict";

  constructor() {
    super("The pricing changed while it was being saved. Reload the page and try again.");
    this.name = "PlanConflictError";
  }
}

export class ExitRunIncompleteError extends Error {
  constructor(
    readonly runId: string,
    readonly failed: number,
  ) {
    super(`${failed} subscriptions are not done yet in exit run ${runId}`);
    this.name = "ExitRunIncompleteError";
  }
}
