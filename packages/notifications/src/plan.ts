import type { PostEvent } from "@cohory/posts";

import type { NotificationDraft, NotificationType } from "./types";

const priority: Record<NotificationType, number> = {
  mention: 3,
  reply: 2,
  comment_on_post: 1,
  like_on_post: 1,
  like_on_comment: 1,
  join_request: 1,
  join_request_approved: 1,
  join_request_declined: 1,
  approval_request: 1,
  agent_access: 1,
  report_actioned: 1,
  report_dismissed: 1,
  review_created: 1,
  paid_membership_changed: 1,
  ownership_transferred: 1,
  payment_disputed: 1,
  member_joined: 1,
  report_created: 1,
  event_created: 1,
  event_reminder: 1,
  paid_member_joined: 1,
  paid_member_canceled: 1,
  member_payment_failed: 1,
  token_expiring: 1,
  comment_on_followed_post: 1,
};

function draftsFor(event: PostEvent): NotificationDraft[] {
  switch (event.type) {
    case "post.created":
    case "post.emailed":
    case "like.added":
    case "like.removed":
    case "post.deleted":
    case "comment.deleted":
    case "report.created":
      return [];
    case "report.resolved": {
      const p = event.payload;
      return p.reporterIds.map((userId) => ({
        communityId: p.communityId,
        userId,
        actorId: p.resolvedBy,
        type:
          p.resolution === "dismissed"
            ? ("report_dismissed" as const)
            : ("report_actioned" as const),
        subjectType: p.commentId ? ("comment" as const) : ("post" as const),
        subjectId: p.commentId ?? p.postId,
        postId: p.postId,
        preview: null,
      }));
    }
    case "mention.created": {
      const p = event.payload;
      return [
        {
          communityId: p.communityId,
          userId: p.mentionedUserId,
          actorId: p.authorId,
          type: "mention",
          subjectType: p.subjectType,
          subjectId: p.subjectId,
          postId: p.postId,
          preview: p.preview ?? null,
        },
      ];
    }
    case "comment.created": {
      const p = event.payload;
      const base = {
        communityId: p.communityId,
        actorId: p.authorId,
        subjectType: "comment" as const,
        subjectId: p.commentId,
        postId: p.postId,
        preview: p.preview ?? null,
      };
      return [
        ...(p.parentAuthorId
          ? [{ ...base, userId: p.parentAuthorId, type: "reply" as const }]
          : []),
        { ...base, userId: p.postAuthorId, type: "comment_on_post" },
      ];
    }
  }
}

export function planNotifications(events: readonly PostEvent[]): NotificationDraft[] {
  const planned = new Map<string, NotificationDraft>();
  for (const event of events) {
    for (const draft of draftsFor(event)) {
      if (draft.userId === draft.actorId) {
        continue;
      }
      const key = `${draft.userId}:${draft.actorId}:${draft.subjectId}`;
      const existing = planned.get(key);
      if (!existing || priority[draft.type] > priority[existing.type]) {
        planned.set(key, draft);
      }
    }
  }
  return [...planned.values()];
}
