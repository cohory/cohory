import { can } from "@cohory/authz";

import type { CommunityAccess } from "../posts/permissions";

function context(access: CommunityAccess) {
  return { role: access.role, communityPrivacy: access.privacy, entitled: access.entitled };
}

export function canListMembers(access: CommunityAccess): boolean {
  return can(access.actor, "list", "membership", context(access));
}

export function canReadLeaderboard(access: CommunityAccess): boolean {
  return can(access.actor, "read", "leaderboard", context(access));
}

export function canEditProfile(access: CommunityAccess, profileUserId: string): boolean {
  return (
    access.actor.kind === "user" &&
    access.actor.userId === profileUserId &&
    can(access.actor, "update_own_profile", "membership", context(access))
  );
}
