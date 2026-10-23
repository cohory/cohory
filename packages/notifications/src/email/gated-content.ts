import { getJoinRequestSnapshots } from "@cohory/communities/join-request-snapshots";
import { parseCommunityId, withCommunity, type Database } from "@cohory/db";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { getPostSnapshotsForNotification } from "@cohory/posts";

import { hasPreview, type DeliveredNotificationType, type NotificationSubjectType } from "../types";

export interface ContentNotice {
  readonly id: string;
  readonly type: DeliveredNotificationType;
  readonly communityId: string | null;
  readonly subjectType: NotificationSubjectType;
  readonly subjectId: string;
  readonly postId: string | null;
  readonly detail: string | null;
}

export interface EmailContent {
  readonly postTitle: string | null;
  readonly excerpts: ReadonlyMap<string, string | null>;
}

const noContent: EmailContent = { postTitle: null, excerpts: new Map() };

function joinAnswers(answers: readonly { readonly answer: string }[]): string {
  return answers
    .map((item) => item.answer.trim())
    .filter((answer) => answer !== "")
    .join(" / ");
}

// Previews and post titles are gated content and may have been removed since the
// notification was stored, so access and removal are checked again at send time.
export async function loadEmailContent(
  db: Database,
  userId: string,
  group: readonly [ContentNotice, ...ContentNotice[]],
  at: Date,
): Promise<EmailContent> {
  const [first] = group;
  if (!first.communityId) {
    return noContent;
  }
  const communityId = first.communityId;
  const postIds = [...new Set(group.flatMap((n) => (n.postId ? [n.postId] : [])))];
  const entitled =
    postIds.length > 0 &&
    (await getCommunityAccess(withCommunity(db, parseCommunityId(communityId)), userId, at))
      .entitled;
  const snapshots = entitled
    ? await getPostSnapshotsForNotification(db, {
        communityId,
        postIds,
        commentIds: group.filter((n) => n.subjectType === "comment").map((n) => n.subjectId),
      })
    : null;
  const requestIds = group
    .filter((n) => n.subjectType === "membership_request")
    .map((n) => n.subjectId);
  const requests =
    requestIds.length > 0
      ? (await getJoinRequestSnapshots(db, { communityId, readerId: userId, requestIds })).requests
      : new Map<string, never>();

  const excerptOf = (n: ContentNotice): string | null => {
    if (hasPreview(n.type)) {
      const live =
        snapshots !== null &&
        n.postId !== null &&
        snapshots.titles.has(n.postId) &&
        (n.subjectType !== "comment" || snapshots.liveComments.has(n.subjectId));
      return live ? n.detail : null;
    }
    const request = requests.get(n.subjectId);
    if (!request) {
      return null;
    }
    return n.type === "join_request" ? joinAnswers(request.answers) : request.decisionNote;
  };
  const title = first.postId ? snapshots?.titles.get(first.postId) : null;
  return {
    postTitle: title?.trim() || null,
    excerpts: new Map(group.map((n) => [n.id, excerptOf(n)])),
  };
}
