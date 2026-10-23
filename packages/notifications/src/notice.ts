import type { EmailContent } from "@cohory/email";

export type NoticeType =
  | "paid_membership_changed"
  | "payment_disputed"
  | "paid_member_joined"
  | "paid_member_canceled"
  | "member_payment_failed";

export interface Notice {
  readonly inApp: boolean;
  readonly type: NoticeType;
  readonly userId: string;
  readonly actorId: string;
  readonly noticeId: string;
  readonly detail: string;
  readonly content: EmailContent | null;
}
