import { safeRedirectPath } from "@cohory/auth";
import { describe, expect, it } from "vitest";

import {
  autoAcceptInvite,
  clearInviteIntent,
  inviteAcceptPath,
  inviteIntentCookieValue,
  isJoinContinuePath,
  joinContinuePath,
  joinFallbackPath,
  joinIntentCookieValue,
  joinIntentSchema,
  joinIntentSlugSchema,
  matchesJoinIntent,
  parseJoinContinuePath,
  planJoinContinuation,
  signUpForJoinPath,
  signUpOfferedFor,
} from "./join-intent";

describe("join intent paths", () => {
  it("builds a same origin continuation path that survives the sign up redirect check", () => {
    for (const intent of ["join", "checkout", "checkout_yearly", "request"] as const) {
      const path = joinContinuePath("makers", intent);
      expect(path).toBe(`/c/makers/join?intent=${intent}`);
      expect(safeRedirectPath(path)).toBe(path);
      expect(isJoinContinuePath(path)).toBe(true);
    }
  });

  it("sends a signed out visitor to sign up with the continuation as next", () => {
    expect(signUpForJoinPath("makers", "checkout")).toBe(
      "/sign-up?next=%2Fc%2Fmakers%2Fjoin%3Fintent%3Dcheckout",
    );
  });

  it("drops return targets that leave the site", () => {
    for (const next of [
      "https://evil.example/c/makers/join?intent=join",
      "//evil.example/c/makers/join",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeRedirectPath(next)).toBe("/");
    }
  });

  it("recognises only the exact continuation shape", () => {
    expect(isJoinContinuePath("/c/makers/join?intent=steal")).toBe(false);
    expect(isJoinContinuePath("/c/makers/join?intent=join&next=//evil.example")).toBe(false);
    expect(isJoinContinuePath("/c/makers/about")).toBe(false);
    expect(isJoinContinuePath("/c/Makers/join?intent=join")).toBe(false);
  });

  it("validates the slug and intent from the request", () => {
    expect(joinIntentSchema.safeParse("checkout").success).toBe(true);
    expect(joinIntentSchema.safeParse("admin").success).toBe(false);
    expect(joinIntentSlugSchema.safeParse("makers-club").success).toBe(true);
    expect(joinIntentSlugSchema.safeParse("../evil").success).toBe(false);
    expect(joinIntentSlugSchema.safeParse("a/b").success).toBe(false);
  });

  it("acts only when the cookie names the same community and intent", () => {
    const value = joinIntentCookieValue("makers", "join");
    expect(matchesJoinIntent(value, "makers", "join")).toBe(true);
    expect(matchesJoinIntent(value, "makers", "checkout")).toBe(false);
    expect(matchesJoinIntent(value, "other", "join")).toBe(false);
    expect(matchesJoinIntent(undefined, "makers", "join")).toBe(false);
  });

  it("falls back to a page without side effects when the intent cannot run", () => {
    expect(joinFallbackPath("makers", "join")).toBe("/c/makers/about");
    expect(joinFallbackPath("makers", "request")).toBe("/c/makers/about?join=request");
    expect(joinFallbackPath("makers", "checkout")).toBe("/c/makers/membership");
    expect(joinFallbackPath("makers", "checkout_yearly")).toBe("/c/makers/membership");
  });
});

describe("planJoinContinuation", () => {
  const base = {
    slug: "makers",
    intent: "join" as const,
    signedIn: true,
    member: false,
    cookieMatches: true,
    questionCount: 0,
  };

  it("asks a signed out person to sign in first", () => {
    expect(planJoinContinuation({ ...base, signedIn: false })).toEqual({ kind: "sign_in" });
  });

  it("joins, starts checkout, or sends the request when the intent is confirmed", () => {
    expect(planJoinContinuation(base)).toEqual({ kind: "join" });
    expect(planJoinContinuation({ ...base, intent: "checkout" })).toEqual({
      kind: "checkout",
      interval: "month",
    });
    expect(planJoinContinuation({ ...base, intent: "checkout_yearly" })).toEqual({
      kind: "checkout",
      interval: "year",
    });
    expect(planJoinContinuation({ ...base, intent: "request" })).toEqual({ kind: "request" });
  });

  it("opens the join questions instead of sending an empty request", () => {
    expect(planJoinContinuation({ ...base, intent: "request", questionCount: 2 })).toEqual({
      kind: "go",
      path: "/c/makers/about?join=request",
    });
  });

  it("asks the join questions on the membership page before checkout", () => {
    expect(planJoinContinuation({ ...base, intent: "checkout", questionCount: 1 })).toEqual({
      kind: "go",
      path: "/c/makers/membership",
    });
  });

  it("does nothing on a link that did not start from the Join button", () => {
    expect(planJoinContinuation({ ...base, cookieMatches: false })).toEqual({
      kind: "go",
      path: "/c/makers/about",
    });
    expect(planJoinContinuation({ ...base, intent: "checkout", cookieMatches: false })).toEqual({
      kind: "go",
      path: "/c/makers/membership",
    });
  });

  it("takes a member straight to the feed", () => {
    expect(planJoinContinuation({ ...base, member: true })).toEqual({
      kind: "go",
      path: "/c/makers",
    });
  });
});

const token = "Tok_en-".repeat(7).slice(0, 43);

describe("invite continuation", () => {
  it("builds an accept path for the invite that survives the sign up redirect check", () => {
    const path = inviteAcceptPath(token);
    expect(path).toBe(`/join/${token}?accept=1`);
    expect(safeRedirectPath(path)).toBe(path);
    expect(isJoinContinuePath(path)).toBe(true);
  });

  it("does not treat the plain invite page or a malformed token as a continuation", () => {
    expect(isJoinContinuePath(`/join/${token}`)).toBe(false);
    expect(isJoinContinuePath("/join/short?accept=1")).toBe(false);
    expect(isJoinContinuePath(`/join/${token}?accept=1&next=//evil.example`)).toBe(false);
  });

  it("reads which community or invite a continuation path is about", () => {
    expect(parseJoinContinuePath(inviteAcceptPath(token))).toEqual({ kind: "invite", token });
    expect(parseJoinContinuePath(joinContinuePath("makers", "checkout_yearly"))).toEqual({
      kind: "community",
      slug: "makers",
      intent: "checkout_yearly",
    });
    expect(parseJoinContinuePath("/c/makers/posts/0199e7a0-0000-7000-8000-000000000001")).toEqual({
      kind: "post",
    });
    expect(parseJoinContinuePath("/communities/new")).toBeNull();
  });

  it("accepts the invite on return only for the person who started from it on this browser", () => {
    const started = inviteIntentCookieValue(token);
    expect(autoAcceptInvite({ accept: "1", signedIn: true, cookie: started, token })).toBe(true);
    expect(autoAcceptInvite({ accept: "1", signedIn: true, cookie: undefined, token })).toBe(false);
    expect(
      autoAcceptInvite({
        accept: "1",
        signedIn: true,
        cookie: inviteIntentCookieValue("x".repeat(43)),
        token,
      }),
    ).toBe(false);
    expect(autoAcceptInvite({ accept: undefined, signedIn: true, cookie: started, token })).toBe(
      false,
    );
    expect(autoAcceptInvite({ accept: "1", signedIn: false, cookie: started, token })).toBe(false);
  });

  it("keeps invite and community join intents apart", () => {
    expect(matchesJoinIntent(inviteIntentCookieValue(token), "makers", "join")).toBe(false);
  });
});

describe("signUpOfferedFor", () => {
  it("offers sign up everywhere when sign up is open", () => {
    expect(signUpOfferedFor("open", "/")).toBe(true);
  });

  it("offers sign up only on the way in through an invite when sign up is by invite", () => {
    expect(signUpOfferedFor("invite", inviteAcceptPath(token))).toBe(true);
    expect(signUpOfferedFor("invite", joinContinuePath("makers", "join"))).toBe(false);
    expect(signUpOfferedFor("invite", "/")).toBe(false);
    expect(signUpOfferedFor("invite", "/communities/new")).toBe(false);
  });

  it("never offers sign up when sign up is closed", () => {
    expect(signUpOfferedFor("closed", inviteAcceptPath(token))).toBe(false);
  });
});

describe("clearInviteIntent", () => {
  function jar(value: string | undefined) {
    const deleted: string[] = [];
    return {
      deleted,
      get: (name: string) => (value === undefined ? undefined : { name, value }),
      delete: (name: string) => {
        deleted.push(name);
      },
    };
  }

  it("forgets the invite once it is redeemed, so a later visit does not join again", () => {
    const cookies = jar(inviteIntentCookieValue(token));
    clearInviteIntent(cookies, token);
    expect(cookies.deleted).toEqual(["cohory_join_intent"]);
  });

  it("keeps a join intent that belongs to something else", () => {
    const cookies = jar(joinIntentCookieValue("makers", "join"));
    clearInviteIntent(cookies, token);
    expect(cookies.deleted).toEqual([]);
  });
});
