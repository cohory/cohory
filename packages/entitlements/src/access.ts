import type { AgentStatus, DelegationEndReason } from "@cohory/db/schema";
import { hasAccess, type MembershipAccess } from "./community-access";

export const delegationDenials = [
  "no_delegation",
  "expired",
  "revoked",
  "human_access_ended",
  "agent_inactive",
  "agent_access_off",
  "wrong_community",
] as const;

export type DelegationDenial = (typeof delegationDenials)[number];

export interface DelegationSnapshot {
  readonly id: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: DelegationEndReason | null;
}

export interface DelegationFacts {
  readonly delegation: DelegationSnapshot | null;
  readonly agentStatus: AgentStatus | null;
  readonly humanAccess: MembershipAccess;
  readonly humanAccessSince?: Date | null;
  readonly allowAgentAccess: boolean;
  readonly now: Date;
}

export type DelegatedAccess =
  | { readonly kind: "delegated"; readonly delegationId: string; readonly expiresAt: Date }
  | { readonly kind: "denied"; readonly reason: DelegationDenial };

const endReasonDenial: Readonly<Record<DelegationEndReason, DelegationDenial>> = {
  revoked: "revoked",
  expired: "expired",
  access_ended: "human_access_ended",
  agent_inactive: "agent_inactive",
  agent_access_off: "agent_access_off",
};

function denied(reason: DelegationDenial): DelegatedAccess {
  return { kind: "denied", reason };
}

export function resolveDelegatedAccess(facts: DelegationFacts): DelegatedAccess {
  if (facts.agentStatus !== "active") {
    return denied("agent_inactive");
  }
  if (!hasAccess(facts.humanAccess)) {
    return denied("human_access_ended");
  }
  if (!facts.allowAgentAccess) {
    return denied("agent_access_off");
  }
  const { delegation } = facts;
  if (!delegation) {
    return denied("no_delegation");
  }
  if (delegation.revokedAt) {
    return denied(endReasonDenial[delegation.revokedReason ?? "revoked"]);
  }
  if (facts.humanAccessSince && delegation.grantedAt < facts.humanAccessSince) {
    return denied("human_access_ended");
  }
  if (delegation.expiresAt <= facts.now) {
    return denied("expired");
  }
  return { kind: "delegated", delegationId: delegation.id, expiresAt: delegation.expiresAt };
}

export function isStaffOwner(access: MembershipAccess): boolean {
  return access.level === "staff" && (access.role === "owner" || access.role === "admin");
}

export function endsForGood(denial: DelegationDenial, agentStatus: AgentStatus | null): boolean {
  return denial !== "agent_inactive" || agentStatus !== "suspended";
}

export function endReasonFor(denial: DelegationDenial): DelegationEndReason | null {
  switch (denial) {
    case "expired":
      return "expired";
    case "human_access_ended":
      return "access_ended";
    case "agent_inactive":
      return "agent_inactive";
    case "agent_access_off":
      return "agent_access_off";
    default:
      return null;
  }
}
