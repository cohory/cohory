export const paidMembershipEventsTopic = "paid_membership.events";

export const paidMembershipRecipientsPerEvent = 100;

export const paidMembershipChanges = [
  "community_deleted",
  "archived_ending",
  "archived_continuing",
  "billed_by_creator",
  "winding_down",
] as const;

export type PaidMembershipChange = (typeof paidMembershipChanges)[number];

export interface PaidMembershipRecipient {
  readonly userId: string;
  readonly endsAt: string | null;
}

export interface PaidMembershipChangedPayload {
  readonly noticeId: string;
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly actorId: string;
  readonly change: PaidMembershipChange;
  readonly supportContact: string | null;
  readonly portalLoginUrl: string | null;
  readonly recipients: readonly PaidMembershipRecipient[];
}

export interface FeeClearRequiredPayload {
  readonly noticeId: string;
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly ownerId: string;
}

export interface PaymentDisputedPayload {
  readonly noticeId: string;
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly ownerId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface DuplicateRefundedPayload {
  readonly noticeId: string;
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly userId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PaidMemberPayload {
  readonly noticeId: string;
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly ownerId: string;
  readonly userId: string;
}

export interface PaidMemberJoinedPayload extends PaidMemberPayload {
  readonly priceMinor: number | null;
  readonly currency: string | null;
  readonly interval: "month" | "year" | null;
}

export interface PaidMemberCanceledPayload extends PaidMemberPayload {
  readonly endsAt: string | null;
}

export interface MemberPaymentFailedPayload extends PaidMemberPayload {
  readonly amountMinor: number;
  readonly currency: string;
  readonly attempt: number;
  readonly nextAttemptAt: string | null;
}

export type PaidMembershipEvent =
  | { readonly type: "paid_membership.changed"; readonly payload: PaidMembershipChangedPayload }
  | { readonly type: "payments.fee_clear_required"; readonly payload: FeeClearRequiredPayload }
  | { readonly type: "payments.payment_disputed"; readonly payload: PaymentDisputedPayload }
  | { readonly type: "payments.duplicate_refunded"; readonly payload: DuplicateRefundedPayload }
  | { readonly type: "payments.paid_member_joined"; readonly payload: PaidMemberJoinedPayload }
  | { readonly type: "payments.paid_member_canceled"; readonly payload: PaidMemberCanceledPayload }
  | {
      readonly type: "payments.member_payment_failed";
      readonly payload: MemberPaymentFailedPayload;
    };

export type PaidMembershipNoticeInput = Omit<PaidMembershipChangedPayload, "recipients"> & {
  readonly recipients: readonly { readonly userId: string; readonly endsAt: Date | null }[];
};

export type NoticeScope = "community" | "detached";

export function paidMembershipEvents(input: PaidMembershipNoticeInput): PaidMembershipEvent[] {
  const { recipients, ...base } = input;
  const seen = new Set<string>();
  const unique = recipients.filter((recipient) => {
    if (seen.has(recipient.userId)) {
      return false;
    }
    seen.add(recipient.userId);
    return true;
  });
  const events: PaidMembershipEvent[] = [];
  for (let start = 0; start < unique.length; start += paidMembershipRecipientsPerEvent) {
    events.push({
      type: "paid_membership.changed",
      payload: {
        ...base,
        recipients: unique
          .slice(start, start + paidMembershipRecipientsPerEvent)
          .map((recipient) => ({
            userId: recipient.userId,
            endsAt: recipient.endsAt?.toISOString() ?? null,
          })),
      },
    });
  }
  return events;
}

export function feeClearRequiredEvent(input: FeeClearRequiredPayload): PaidMembershipEvent {
  return { type: "payments.fee_clear_required", payload: input };
}
