import type { NotificationSubjectType, NotificationType } from "./types";

export interface RenderInput {
  readonly type: NotificationType;
  readonly subjectType: NotificationSubjectType;
  readonly actorName: string;
  readonly detail?: string | null;
}

export function groupCount(detail: string | null | undefined): number {
  const trimmed = detail?.trim() ?? "";
  return /^\d{1,9}$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0;
}

function liked(name: string, others: number, subject: "post" | "comment"): string {
  if (others === 0) {
    return `${name} liked your ${subject}`;
  }
  return `${name} and ${others} ${others === 1 ? "other" : "others"} liked your ${subject}`;
}

export function renderNotificationText({
  type,
  subjectType,
  actorName,
  detail,
}: RenderInput): string {
  const name = actorName.trim() || "Someone";
  switch (type) {
    case "mention":
      return `${name} mentioned you in a ${subjectType}`;
    case "reply":
      return `${name} replied to your comment`;
    case "comment_on_post":
      return `${name} commented on your post`;
    case "like_on_post":
      return liked(name, groupCount(detail), "post");
    case "like_on_comment":
      return liked(name, groupCount(detail), "comment");
    case "join_request":
      return `${name} asked to join`;
    case "join_request_approved":
      return "Your request to join was approved";
    case "join_request_declined":
      return "Your request to join was declined";
    case "approval_request":
      return detail?.trim() || `An agent of ${name} asks for your approval`;
    case "agent_access":
      return detail?.trim() || "Something changed in your agents' course access";
    case "report_actioned":
      return `A moderator acted on the ${subjectType} you reported`;
    case "report_dismissed":
      return `A moderator reviewed the ${subjectType} you reported and left it up`;
    case "review_created":
      return `${name} left a review of your community`;
    case "paid_membership_changed":
      return detail?.trim() || "Something changed in your paid membership";
    case "ownership_transferred":
      return detail?.trim() || `${name} transferred ownership of the community`;
    case "payment_disputed":
      return detail?.trim() || "A member disputed a payment";
    case "member_joined": {
      const others = groupCount(detail);
      return others === 0
        ? `${name} joined the community`
        : `${name} and ${others} ${others === 1 ? "other" : "others"} joined the community`;
    }
    case "report_created": {
      const reports = groupCount(detail);
      return reports > 1
        ? `${reports} new reports are waiting for review`
        : "A new report is waiting for review";
    }
    case "event_created":
      return detail?.trim() || `${name} scheduled a new event`;
    case "event_reminder":
      return detail?.trim() || "An event you are going to starts soon";
    case "paid_member_joined":
      return detail?.trim() || `${name} joined as a paying member`;
    case "paid_member_canceled":
      return detail?.trim() || `${name} canceled their paid membership`;
    case "member_payment_failed":
      return detail?.trim() || `A payment from ${name} failed`;
    case "token_expiring":
      return detail?.trim() || "One of your tokens expires in 7 days";
    case "comment_on_followed_post":
      return `${name} commented on a post you follow`;
  }
}
