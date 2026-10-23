import {
  grants,
  type MembershipSnapshot,
  type SubscriptionAccessState,
} from "@cohory/entitlements/access";

export {
  accessEndAfterClose,
  accessStateFor,
  compGrants,
  grants,
  hasAccess,
  resolveMembershipAccess,
  type AccessInput,
  type AccessLevel,
  type CompSnapshot,
  type MembershipAccess,
  type MembershipSnapshot,
  type SubscriptionAccessState,
  type SubscriptionSnapshot,
} from "@cohory/entitlements/access";

export type MembershipSyncAction = "activate" | "remove" | "none";

export interface MembershipSyncInput {
  readonly membership: MembershipSnapshot | null;
  readonly previous: SubscriptionAccessState | null;
  readonly next: SubscriptionAccessState;
  readonly otherAccess?: boolean;
}

export function membershipSyncAction(input: MembershipSyncInput): MembershipSyncAction {
  const { membership, previous, next } = input;
  if (membership?.status === "banned") {
    return "none";
  }
  if (grants(next)) {
    if (membership?.status === "active") {
      return "none";
    }
    const deliberatelyRemoved =
      membership?.status === "removed" &&
      (membership.removalReason === "left" || membership.removalReason === "removed");
    return deliberatelyRemoved && grants(previous) ? "none" : "activate";
  }
  const paidFor = next === "revoked" || grants(previous);
  if (
    membership?.status === "active" &&
    membership.role === "member" &&
    paidFor &&
    input.otherAccess !== true
  ) {
    return "remove";
  }
  return "none";
}
