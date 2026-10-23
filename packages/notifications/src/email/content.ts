import { emailSafeName, flattenEmailText } from "@cohory/email";

import { emailReasons } from "../preferences";
import { groupCount, renderNotificationText } from "../render";
import type { DeliveredNotificationType, NotificationSubjectType } from "../types";

const maxExcerptLength = 200;

export interface EmailNotice {
  readonly type: DeliveredNotificationType;
  readonly subjectType: NotificationSubjectType;
  readonly actorName: string;
  readonly detail: string | null;
  readonly excerpt: string | null;
}

export interface NotificationEmailModel {
  readonly subject: string;
  readonly heading?: string;
  readonly items: readonly { readonly sentence: string; readonly excerpt: string | null }[];
  readonly ctaLabel: string;
  readonly reason: string;
  readonly scope: DeliveredNotificationType;
  readonly stopLabel?: string;
}

export function emailExcerpt(raw: string | null | undefined): string | null {
  const flat = flattenEmailText(raw ?? "");
  if (flat === "") {
    return null;
  }
  const characters = Array.from(flat);
  return characters.length > maxExcerptLength
    ? `${characters
        .slice(0, maxExcerptLength - 3)
        .join("")
        .trimEnd()}...`
    : flat;
}

export function emailLine(n: EmailNotice): string {
  return renderNotificationText({ ...n, actorName: emailSafeName(n.actorName) ?? "" });
}

function withOthers(name: string, others: number): string {
  return others === 0 ? name : `${name} and ${others} ${others === 1 ? "other" : "others"}`;
}

function sentence(n: EmailNotice, community: string): string {
  const name = emailSafeName(n.actorName) ?? "Someone";
  switch (n.type) {
    case "join_request":
      return `${name} asked to join ${community}.`;
    case "join_request_approved":
      return `Your request to join ${community} was approved.`;
    case "join_request_declined":
      return `Your request to join ${community} was declined.`;
    case "review_created":
      return `${name} left a review of ${community}.`;
    case "member_joined":
      return `${withOthers(name, groupCount(n.detail))} joined ${community}.`;
    default:
      return `${emailLine(n).replace(/[.\s]+$/, "")} in ${community}.`;
  }
}

function ctaLabel(n: EmailNotice, community: string): string {
  switch (n.type) {
    case "join_request":
      return "Review the request";
    case "join_request_approved":
    case "join_request_declined":
      return `Open ${community}`;
    case "approval_request":
      return "Review the approval";
    case "agent_access":
      return "Open your agents";
    case "review_created":
      return "Read the review";
    case "member_joined":
    case "paid_member_joined":
    case "paid_member_canceled":
      return "Open People";
    case "report_created":
      return "Review the reports";
    case "event_created":
    case "event_reminder":
      return "Open the calendar";
    default:
      return n.subjectType === "comment" ? "Open the comment" : "Open the post";
  }
}

export function composeNotificationEmail(input: {
  readonly notices: readonly [EmailNotice, ...EmailNotice[]];
  readonly communityName: string;
  readonly postTitle: string | null;
  readonly postId?: string | null;
}): NotificationEmailModel {
  const { notices, communityName } = input;
  const postTitle = input.postTitle ? flattenEmailText(input.postTitle) || null : null;
  // Mail apps thread by subject, so every email about one post keeps the same one.
  const postSubject =
    postTitle ?? (input.postId ? `New activity on a post (${input.postId.slice(-4)})` : null);
  const [first] = notices;
  const count = notices.length;
  const types = [...new Set(notices.map((n) => n.type))];
  const items = notices.map((n) => ({
    sentence: sentence(n, communityName),
    excerpt: emailExcerpt(n.excerpt),
  }));
  const shared = {
    items,
    reason: types.map((type) => emailReasons[type]).join(" and "),
    scope: first.type,
    ...(types.length > 1 ? { stopLabel: `Stop emails about ${emailReasons[first.type]}` } : {}),
  };
  if (count === 1) {
    return {
      ...shared,
      subject: postSubject ?? emailLine(first),
      ctaLabel: ctaLabel(first, communityName),
    };
  }
  if (first.type === "join_request") {
    return {
      ...shared,
      subject: `${count} people asked to join`,
      heading: `${count} people asked to join ${communityName}.`,
      ctaLabel: "Review the requests",
    };
  }
  return {
    ...shared,
    subject: postSubject ?? `${count} updates on a post`,
    heading: postTitle ? `${count} updates on "${postTitle}"` : `${count} updates on a post`,
    ctaLabel: "Open the post",
  };
}

const sameKindSummaries: Partial<Record<DeliveredNotificationType, string>> = {
  mention: "mentioned you",
  reply: "replied to your comments",
  comment_on_post: "commented on your posts",
  join_request: "asked to join your communities",
};

export function digestSubject(notices: readonly EmailNotice[]): string {
  const [first] = notices;
  if (!first) {
    return "Your daily summary";
  }
  if (notices.length === 1) {
    return emailLine(first);
  }
  const summary = sameKindSummaries[first.type];
  if (summary && notices.every((n) => n.type === first.type)) {
    const names = new Set(notices.map((n) => emailSafeName(n.actorName) ?? "Someone"));
    const lead = emailSafeName(first.actorName) ?? "Someone";
    return `${withOthers(lead, names.size - 1)} ${summary}`;
  }
  return `${emailLine(first)} and ${notices.length - 1} more`;
}
