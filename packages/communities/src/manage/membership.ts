import type { Membership } from "@cohory/db";

import { InviteUnavailableError } from "../errors";
import type { ManageStore } from "./repository";
import type { RedeemedInvite } from "./views";

export function membershipView(membership: Membership): NonNullable<RedeemedInvite["membership"]> {
  return {
    id: membership.id,
    communityId: membership.communityId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
  };
}

export async function activate(
  store: ManageStore,
  userId: string,
  existing: Membership | null,
  joinedAt: Date,
): Promise<{ membership: Membership; joined: boolean }> {
  if (existing) {
    const reactivated = await store.setStatus(userId, "active", { joinedAt, role: "member" });
    if (!reactivated) {
      throw new InviteUnavailableError();
    }
    return { membership: reactivated, joined: true };
  }
  const inserted = await store.insertMembershipIfAbsent(userId, joinedAt);
  if (inserted) {
    return { membership: inserted, joined: true };
  }
  const raced = await store.findMember(userId);
  if (raced?.status !== "active") {
    throw new InviteUnavailableError();
  }
  return { membership: raced, joined: false };
}
