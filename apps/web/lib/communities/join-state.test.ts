import { describe, expect, it } from "vitest";

import { resolveJoinState, type JoinStateInput } from "./join-state";

const base: JoinStateInput = {
  signedIn: true,
  slug: "makers",
  joinMode: "approval",
  questions: [{ text: "Why join?", required: true }],
  archived: false,
  paidJoin: null,
  canRejoin: false,
  status: { membershipStatus: null, request: null },
};

const request = (status: "pending" | "approved" | "declined", note: string | null = null) => ({
  id: "r",
  status,
  decisionNote: note,
  createdAt: new Date(),
  decidedAt: null,
});

describe("resolveJoinState", () => {
  it("shows Join for open join and the questions form for approval", () => {
    expect(resolveJoinState({ ...base, joinMode: "open" })).toEqual({ kind: "join" });
    expect(resolveJoinState(base)).toEqual({ kind: "request", questions: base.questions });
  });

  it("shows invite only copy instead of a form", () => {
    expect(resolveJoinState({ ...base, joinMode: "invite" })).toEqual({ kind: "invite_only" });
  });

  it("sells a paid community to anyone when it is open, approval being payment", () => {
    const paidJoin = { label: "Join for $5.00/month", yearlyLabel: null, asksQuestions: false };
    for (const joinMode of ["open", "approval"] as const) {
      expect(resolveJoinState({ ...base, joinMode, paidJoin })).toEqual({ kind: "paid", paidJoin });
    }
  });

  it("hides checkout in an invite only paid community until the person used an invite", () => {
    const paidJoin = { label: "Join for $5.00/month", yearlyLabel: null, asksQuestions: false };
    const invite = { ...base, joinMode: "invite" as const, paidJoin };

    expect(resolveJoinState(invite)).toEqual({ kind: "invite_only" });
    expect(resolveJoinState({ ...invite, signedIn: false, status: null })).toEqual({
      kind: "invite_only",
    });
    expect(
      resolveJoinState({ ...invite, status: { membershipStatus: "pending", request: null } }),
    ).toEqual({ kind: "paid", paidJoin });
  });

  it("offers joining again without checkout to a member who left with paid access left", () => {
    const paidJoin = { label: "Join for $5.00/month", yearlyLabel: null, asksQuestions: false };
    const left = {
      ...base,
      paidJoin,
      canRejoin: true,
      status: { membershipStatus: "removed" as const, request: null },
    };

    expect(resolveJoinState(left)).toEqual({ kind: "rejoin" });
    expect(resolveJoinState({ ...left, archived: true })).toEqual({ kind: "unavailable" });
    expect(resolveJoinState({ ...left, canRejoin: false })).toEqual({ kind: "paid", paidJoin });
  });

  it("shows a pending request and a declined request with its note", () => {
    expect(
      resolveJoinState({
        ...base,
        status: { membershipStatus: null, request: request("pending") },
      }),
    ).toEqual({ kind: "pending" });
    expect(
      resolveJoinState({
        ...base,
        status: { membershipStatus: null, request: request("declined", "Not now") },
      }),
    ).toEqual({ kind: "declined", note: "Not now", questions: base.questions });
  });

  it("sends a signed out visitor to sign up with the intent for the community", () => {
    const out = { ...base, signedIn: false, status: null };
    expect(resolveJoinState(out)).toEqual({
      kind: "sign_up",
      intent: "request",
      label: "Request to join",
    });
    expect(resolveJoinState({ ...out, joinMode: "open" })).toEqual({
      kind: "sign_up",
      intent: "join",
      label: "Join community",
    });
    expect(resolveJoinState({ ...out, joinMode: "invite" })).toEqual({ kind: "invite_only" });
    const paidJoin = {
      label: "Join for $5.00/month",
      yearlyLabel: "Yearly $50.00",
      asksQuestions: false,
    };
    expect(resolveJoinState({ ...out, paidJoin })).toEqual({
      kind: "sign_up",
      intent: "checkout",
      label: "Join for $5.00/month",
      yearlyLabel: "Yearly $50.00",
    });
  });

  it("offers nothing to a banned person or in an archived community", () => {
    expect(
      resolveJoinState({ ...base, status: { membershipStatus: "banned", request: null } }),
    ).toEqual({ kind: "unavailable" });
    expect(resolveJoinState({ ...base, archived: true })).toEqual({ kind: "unavailable" });
  });

  it("recognises an active member", () => {
    expect(
      resolveJoinState({ ...base, status: { membershipStatus: "active", request: null } }),
    ).toEqual({ kind: "member" });
  });
});
