import type { NotificationSubjectType, NotificationType } from "@cohory/db/schema";

export type { NotificationSubjectType, NotificationType };

export const deliveredNotificationTypes = [
  "mention",
  "reply",
  "comment_on_post",
  "join_request",
  "join_request_approved",
  "join_request_declined",
  "approval_request",
  "agent_access",
  "report_actioned",
  "report_dismissed",
  "review_created",
  "member_joined",
  "like_on_post",
  "like_on_comment",
  "report_created",
  "paid_member_joined",
  "paid_member_canceled",
  "event_created",
  "event_reminder",
  "comment_on_followed_post",
] as const satisfies readonly NotificationType[];

export type DeliveredNotificationType = (typeof deliveredNotificationTypes)[number];

export const transactionalNotificationTypes = [
  "paid_membership_changed",
  "ownership_transferred",
  "payment_disputed",
  "member_payment_failed",
  "token_expiring",
] as const satisfies readonly NotificationType[];

export const inAppNotificationTypes = [
  ...deliveredNotificationTypes,
  ...transactionalNotificationTypes,
] as const;

export type InAppNotificationType = (typeof inAppNotificationTypes)[number];

export const previewNotificationTypes = [
  "mention",
  "reply",
  "comment_on_post",
  "comment_on_followed_post",
] as const satisfies readonly NotificationType[];

export function hasPreview(type: string): boolean {
  return (previewNotificationTypes as readonly string[]).includes(type);
}

export interface NotificationDraft {
  readonly communityId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly type: NotificationType;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly postId: string | null;
  readonly preview: string | null;
}

export interface NotificationActor {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface NotificationCommunity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface NotificationView {
  readonly id: string;
  readonly type: InAppNotificationType;
  readonly community: NotificationCommunity;
  readonly actor: NotificationActor;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly postId: string | null;
  readonly href: string;
  readonly text: string;
  readonly preview: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationPage {
  readonly data: readonly NotificationView[];
  readonly nextCursor: string | null;
}
