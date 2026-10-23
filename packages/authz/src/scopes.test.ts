import { describe, expect, it } from "vitest";

import {
  availableScopes,
  defaultScopes,
  memberAgentScopes,
  parseScopes,
  scopeDescription,
  scopeDetails,
  scopes,
  scopeSchema,
} from "./scopes";

describe("scopes", () => {
  it("lists the scopes from authorization.md section 6", () => {
    expect([...scopes]).toEqual([
      "community:read",
      "posts:read",
      "comments:read",
      "posts:write",
      "comments:write",
      "courses:read",
      "courses:write",
      "events:read",
      "events:write",
      "members:read",
      "members:moderate",
      "members:export",
      "notifications:read",
      "payments:read",
      "settings:read",
      "webhooks:read",
      "webhooks:write",
      "proposals:write",
    ]);
  });

  it("has no wildcard", () => {
    expect(scopeSchema.safeParse("*").success).toBe(false);
    expect(scopeSchema.safeParse("posts:*").success).toBe(false);
  });

  it.each(scopes)("describes %s in plain language", (scope) => {
    expect(scopeDetails[scope].label.length).toBeGreaterThan(3);
    expect(scopeDetails[scope].description).toMatch(/\.$/);
  });

  it("preselects only read scopes", () => {
    expect(defaultScopes).toEqual([
      "community:read",
      "posts:read",
      "comments:read",
      "courses:read",
      "events:read",
    ]);
    for (const scope of defaultScopes) {
      expect(scopeDetails[scope].access).toBe("read");
    }
  });

  it("deduplicates and sorts parsed scopes and refuses unknown ones", () => {
    expect(parseScopes(["posts:write", "community:read", "posts:write"])).toEqual([
      "community:read",
      "posts:write",
    ]);
    expect(() => parseScopes(["admin"])).toThrow();
  });

  it("never offers the reserved notifications permission", () => {
    expect(scopeDetails["notifications:read"].pickable).toBe(false);
    for (const role of ["owner", "admin", "moderator", "member"] as const) {
      expect(availableScopes(role, "token")).not.toContain("notifications:read");
      expect(availableScopes(role, "agent")).not.toContain("notifications:read");
    }
  });

  it("offers a member's token only what a member can use", () => {
    expect(availableScopes("member", "token")).toEqual([
      "community:read",
      "posts:read",
      "comments:read",
      "posts:write",
      "comments:write",
      "courses:read",
      "events:read",
      "events:write",
      "members:read",
    ]);
  });

  it("adds moderation for moderators but not money, settings, or webhooks", () => {
    const available = availableScopes("moderator", "token");
    expect(available).toContain("members:moderate");
    for (const scope of [
      "payments:read",
      "settings:read",
      "webhooks:read",
      "webhooks:write",
      "courses:write",
      "members:export",
      "proposals:write",
    ] as const) {
      expect(available).not.toContain(scope);
    }
  });

  it("keeps the member export for owners and Propose changes for agents", () => {
    expect(availableScopes("owner", "token")).toContain("members:export");
    expect(availableScopes("admin", "token")).not.toContain("members:export");
    expect(availableScopes("owner", "token")).not.toContain("proposals:write");
    expect(availableScopes("owner", "agent")).toContain("proposals:write");
  });

  it("limits agents of members and moderators to the member agent permissions", () => {
    expect(availableScopes("member", "personal_agent")).toEqual([...memberAgentScopes]);
    expect(availableScopes("moderator", "personal_agent")).toEqual([...memberAgentScopes]);
  });

  it("offers nothing to people without a role", () => {
    expect(availableScopes(null, "token")).toEqual([]);
  });

  it("marks the member export as sensitive instead of read", () => {
    expect(scopeDetails["members:export"].access).toBe("sensitive");
  });

  it("says a read of courses also records progress and submissions", () => {
    expect(scopeDetails["courses:read"].description).toMatch(/mark lessons complete/);
  });

  it("names where purchase and staff requests wait", () => {
    expect(scopeDescription("proposals:write", "member")).toMatch(/Account, Agents/);
    expect(scopeDescription("proposals:write", "staff")).toMatch(/Manage, Approvals/);
    expect(scopeDescription("posts:read", "member")).toBe(scopeDetails["posts:read"].description);
  });
});
