import type { NotificationSubjectType, NotificationType } from "./types";

export interface NotificationLinkInput {
  readonly type: NotificationType;
  readonly subjectType: NotificationSubjectType;
  readonly communitySlug: string;
  readonly postId: string | null;
}

export function notificationPath(input: NotificationLinkInput): string {
  const community = `/c/${encodeURIComponent(input.communitySlug)}`;
  switch (input.type) {
    case "join_request":
      return `${community}/manage/inbox?tab=requests`;
    case "join_request_approved":
      return community;
    case "join_request_declined":
      return `${community}/about`;
    case "approval_request":
      return `${community}/manage/inbox?tab=approvals`;
    case "review_created":
      return `${community}/about#reviews`;
    case "paid_membership_changed":
      return `${community}/membership`;
    case "ownership_transferred":
    case "payment_disputed":
      return `${community}/manage/payments`;
    case "member_joined":
    case "paid_member_joined":
    case "paid_member_canceled":
    case "member_payment_failed":
      return `${community}/manage/people`;
    case "report_created":
      return `${community}/manage/inbox?tab=reports`;
    case "event_created":
    case "event_reminder":
      return `${community}/calendar`;
    case "token_expiring":
      return input.subjectType === "api_token"
        ? "/account/api-tokens"
        : `/account/agents?community=${encodeURIComponent(input.communitySlug)}`;
    case "agent_access":
      return `/account/agents?community=${encodeURIComponent(input.communitySlug)}`;
    default:
      return input.postId ? `${community}/posts/${encodeURIComponent(input.postId)}` : community;
  }
}
