import {
  formatMinorAmount,
  memberPaymentFailedEmail,
  memberPaymentFailedNoticeText,
  type CommunityBrandInput,
} from "@cohory/email";
import type { PaidMembershipEventsJobPayload } from "@cohory/events";

import type { Notice } from "./notice";

type PaidMembershipEvent = PaidMembershipEventsJobPayload["events"][number];

export type MoneyEvent = Extract<
  PaidMembershipEvent,
  {
    type:
      | "payments.paid_member_joined"
      | "payments.paid_member_canceled"
      | "payments.member_payment_failed";
  }
>;

export const maxPaymentFailedEmails = 3;

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function isMoneyEvent(event: PaidMembershipEvent): event is MoneyEvent {
  return (
    event.type === "payments.paid_member_joined" ||
    event.type === "payments.paid_member_canceled" ||
    event.type === "payments.member_payment_failed"
  );
}

export interface MoneyNoticeInput {
  readonly memberName: string;
  readonly membershipUrl: string | null;
  readonly communityBrand?: CommunityBrandInput;
}

function canceledText(name: string, endsAt: string | null): string {
  const ends = endsAt
    ? `Access ends on ${dateFormat.format(new Date(endsAt))}.`
    : "Access ends at the end of the billing period.";
  return `${name} canceled their paid membership. ${ends}`;
}

function joinedText(
  name: string,
  price: { priceMinor: number | null; currency: string | null; interval: "month" | "year" | null },
): string {
  if (price.priceMinor === null || price.currency === null) {
    return `${name} joined as a paying member`;
  }
  const amount = formatMinorAmount(price.priceMinor, price.currency);
  return `${name} joined and pays ${amount}${price.interval ? `/${price.interval}` : ""}`;
}

function failedForOwner(name: string, amount: string, nextAttemptAt: string | null): string {
  const next = nextAttemptAt
    ? `Stripe will try again on ${dateFormat.format(new Date(nextAttemptAt))}.`
    : "Stripe will not try again automatically.";
  return `A payment of ${amount} from ${name} failed. ${next}`;
}

export function moneyNotices(event: MoneyEvent, input: MoneyNoticeInput): Notice[] {
  const { payload } = event;
  const name = input.memberName.trim() || "A member";
  const owner = {
    inApp: true,
    userId: payload.ownerId,
    actorId: payload.userId,
    noticeId: payload.noticeId,
    content: null,
  };
  if (event.type === "payments.paid_member_joined") {
    return [{ ...owner, type: "paid_member_joined", detail: joinedText(name, event.payload) }];
  }
  if (event.type === "payments.paid_member_canceled") {
    return [
      {
        ...owner,
        type: "paid_member_canceled",
        detail: canceledText(name, event.payload.endsAt),
      },
    ];
  }
  const failed = event.payload;
  if (failed.attempt > maxPaymentFailedEmails && failed.nextAttemptAt !== null) {
    return [];
  }
  const copy = {
    communityName: failed.communityName,
    amountMinor: failed.amountMinor,
    currency: failed.currency,
    nextAttemptAt: failed.nextAttemptAt ? new Date(failed.nextAttemptAt) : null,
  };
  const ownerNotice: Notice[] =
    failed.attempt === 1
      ? [
          {
            ...owner,
            type: "member_payment_failed",
            detail: failedForOwner(
              name,
              formatMinorAmount(failed.amountMinor, failed.currency),
              failed.nextAttemptAt,
            ),
          },
        ]
      : [];
  if (!input.membershipUrl) {
    return ownerNotice;
  }
  return [
    ...ownerNotice,
    {
      inApp: true,
      type: "paid_membership_changed",
      userId: failed.userId,
      actorId: failed.userId,
      noticeId: failed.noticeId,
      detail: memberPaymentFailedNoticeText(copy),
      content: memberPaymentFailedEmail({
        ...copy,
        membershipUrl: input.membershipUrl,
        communityBrand: input.communityBrand,
      }),
    },
  ];
}
