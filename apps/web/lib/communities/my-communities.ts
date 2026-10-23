import { getCommunitiesService, type CommunityWithMembership } from "@cohory/communities";
import { getNotificationsService } from "@cohory/notifications";
import { cache } from "react";

import { actorFor } from "../actor";
import { currentSession } from "../session";

export interface MyCommunity extends CommunityWithMembership {
  readonly unread: number;
}

export const loadMyCommunities = cache(async (): Promise<MyCommunity[] | null> => {
  const session = await currentSession();
  if (!session) {
    return null;
  }
  const actor = actorFor(session);
  const [rows, unread] = await Promise.all([
    getCommunitiesService().listCommunitiesForUser(actor),
    getNotificationsService()
      .unreadCountsByCommunity(actor)
      .catch(() => new Map<string, number>()),
  ]);
  return rows.map((row) => ({ ...row, unread: unread.get(row.community.id) ?? 0 }));
});
