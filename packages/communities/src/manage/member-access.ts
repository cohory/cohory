import type { Actor } from "@cohory/authz";
import { getPaymentsService, type MemberAccessKind, type MemberAccessMap } from "@cohory/payments";

import type { UserIdFilter } from "./repository";
import type { MemberAccessFilter } from "./schemas";

export interface MemberAccessPort {
  list(
    actor: Actor,
    communityId: string,
    userIds: readonly string[] | null,
  ): Promise<MemberAccessMap>;
}

export const paymentsMemberAccess: MemberAccessPort = {
  list: (actor, communityId, userIds) =>
    getPaymentsService().listMemberAccess(actor, communityId, userIds),
};

const payingAccess: ReadonlySet<MemberAccessKind> = new Set([
  "paying_monthly",
  "paying_yearly",
  "past_due",
  "cancelling",
]);

export function accessUserFilter(filter: MemberAccessFilter, map: MemberAccessMap): UserIdFilter {
  if (filter === "none") {
    return { mode: "exclude", ids: [...map.keys()] };
  }
  const matches = (access: MemberAccessKind) =>
    filter === "paying" ? payingAccess.has(access) : access === filter;
  return {
    mode: "include",
    ids: [...map].filter(([, entry]) => matches(entry.access)).map(([userId]) => userId),
  };
}
