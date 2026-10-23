import type { MembershipAccess } from "./community-access";
import { describe, expect, it } from "vitest";

import { endsForGood, isStaffOwner, resolveDelegatedAccess, type DelegationFacts } from "./access";

const now = new Date("2026-10-19T12:00:00Z");
const later = new Date("2026-11-18T12:00:00Z");
const earlier = new Date("2026-10-18T12:00:00Z");

const subscribed: MembershipAccess = {
  level: "member",
  source: "subscription",
  state: "granted",
  currentPeriodEnd: later,
  cancelAtPeriodEnd: false,
};

function facts(overrides: Partial<DelegationFacts> = {}): DelegationFacts {
  return {
    delegation: {
      id: "d1",
      grantedAt: earlier,
      expiresAt: later,
      revokedAt: null,
      revokedReason: null,
    },
    agentStatus: "active",
    humanAccess: subscribed,
    allowAgentAccess: true,
    now,
    ...overrides,
  };
}

describe("resolveDelegatedAccess", () => {
  it("grants read access through a live delegation", () => {
    expect(resolveDelegatedAccess(facts())).toEqual({
      kind: "delegated",
      delegationId: "d1",
      expiresAt: later,
    });
  });

  it("keeps access while the human's payment is past due, like the human", () => {
    const grace: MembershipAccess = { ...subscribed, state: "grace" };
    expect(resolveDelegatedAccess(facts({ humanAccess: grace })).kind).toBe("delegated");
  });

  it("keeps access while the human's comp is open", () => {
    const comp: MembershipAccess = { level: "member", source: "comp", expiresAt: later };
    expect(resolveDelegatedAccess(facts({ humanAccess: comp })).kind).toBe("delegated");
  });

  it.each<[string, MembershipAccess]>([
    ["subscription ended", { level: "payment_required", reason: "ended" }],
    ["never paid", { level: "payment_required", reason: "no_subscription" }],
    ["membership removed", { level: "not_member" }],
    ["banned", { level: "banned" }],
  ])("ends when the human's access ended: %s", (_, humanAccess) => {
    expect(resolveDelegatedAccess(facts({ humanAccess }))).toEqual({
      kind: "denied",
      reason: "human_access_ended",
    });
  });

  it("denies without a delegation", () => {
    expect(resolveDelegatedAccess(facts({ delegation: null }))).toEqual({
      kind: "denied",
      reason: "no_delegation",
    });
  });

  it("denies a revoked delegation", () => {
    const delegation = {
      id: "d1",
      grantedAt: earlier,
      expiresAt: later,
      revokedAt: earlier,
      revokedReason: "revoked" as const,
    };
    expect(resolveDelegatedAccess(facts({ delegation }))).toEqual({
      kind: "denied",
      reason: "revoked",
    });
  });

  it("reports the recorded reason of a delegation the job ended", () => {
    const delegation = {
      id: "d1",
      grantedAt: earlier,
      expiresAt: later,
      revokedAt: earlier,
      revokedReason: "access_ended" as const,
    };
    expect(resolveDelegatedAccess(facts({ delegation }))).toEqual({
      kind: "denied",
      reason: "human_access_ended",
    });
  });

  it("denies an expired delegation before the sweep marks it", () => {
    const delegation = {
      id: "d1",
      grantedAt: earlier,
      expiresAt: now,
      revokedAt: null,
      revokedReason: null,
    };
    expect(resolveDelegatedAccess(facts({ delegation }))).toEqual({
      kind: "denied",
      reason: "expired",
    });
  });

  it.each(["suspended", "revoked"] as const)("denies a %s agent", (agentStatus) => {
    expect(resolveDelegatedAccess(facts({ agentStatus }))).toEqual({
      kind: "denied",
      reason: "agent_inactive",
    });
  });

  it("denies an unknown agent", () => {
    expect(resolveDelegatedAccess(facts({ agentStatus: null })).kind).toBe("denied");
  });

  it("denies a delegation granted before the person's current membership began", () => {
    expect(resolveDelegatedAccess(facts({ humanAccessSince: now }))).toEqual({
      kind: "denied",
      reason: "human_access_ended",
    });
    expect(resolveDelegatedAccess(facts({ humanAccessSince: earlier })).kind).toBe("delegated");
    expect(resolveDelegatedAccess(facts({ humanAccessSince: null })).kind).toBe("delegated");
  });

  it("ends delegations for good except while the agent is paused", () => {
    expect(endsForGood("agent_inactive", "suspended")).toBe(false);
    expect(endsForGood("agent_inactive", "revoked")).toBe(true);
    expect(endsForGood("agent_inactive", null)).toBe(true);
    expect(endsForGood("human_access_ended", "active")).toBe(true);
  });

  it("denies when the creator turned agent access off", () => {
    expect(resolveDelegatedAccess(facts({ allowAgentAccess: false }))).toEqual({
      kind: "denied",
      reason: "agent_access_off",
    });
  });
});

describe("isStaffOwner", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["moderator", false],
  ] as const)("treats an agent of a %s as staff: %s", (role, expected) => {
    expect(isStaffOwner({ level: "staff", role })).toBe(expected);
  });

  it("does not treat members as staff", () => {
    expect(isStaffOwner(subscribed)).toBe(false);
  });
});
