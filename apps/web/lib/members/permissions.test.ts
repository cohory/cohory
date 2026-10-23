import type { Actor, CommunityPrivacy, CommunityRole } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import type { CommunityAccess } from "../posts/permissions";
import { canEditProfile, canListMembers, canReadLeaderboard } from "./permissions";

const me = "0192f2a4-0000-7000-8000-0000000000aa";
const other = "0192f2a4-0000-7000-8000-0000000000bb";

function access(
  role: CommunityRole | null,
  privacy: CommunityPrivacy = "public",
  userId = me,
  entitled = true,
): CommunityAccess {
  const actor: Actor = { kind: "user", userId, platformAdmin: false };
  return { actor, role, entitled, privacy };
}

const guest: CommunityAccess = {
  actor: { kind: "guest" },
  role: null,
  entitled: false,
  privacy: "public",
};

describe("profile edit policy", () => {
  it.each(["member", "moderator", "admin", "owner"] as const)(
    "lets a %s edit their own profile",
    (role) => {
      expect(canEditProfile(access(role), me)).toBe(true);
    },
  );

  it.each(["member", "moderator", "admin", "owner"] as const)(
    "does not let a %s edit someone else's profile",
    (role) => {
      expect(canEditProfile(access(role), other)).toBe(false);
    },
  );

  it("does not let a non member or a guest edit a profile", () => {
    expect(canEditProfile(access(null), me)).toBe(false);
    expect(canEditProfile(guest, me)).toBe(false);
  });
});

describe("directory and leaderboard policy", () => {
  it("lets members of private and public communities list members and read the leaderboard", () => {
    for (const privacy of ["public", "private"] as const) {
      expect(canListMembers(access("member", privacy))).toBe(true);
      expect(canReadLeaderboard(access("member", privacy))).toBe(true);
    }
  });

  it("hides the directory and leaderboard from guests and non members, even on public communities", () => {
    expect(canListMembers(guest)).toBe(false);
    expect(canListMembers(access(null))).toBe(false);
    expect(canReadLeaderboard(guest)).toBe(false);
    expect(canReadLeaderboard(access(null, "private"))).toBe(false);
  });

  it("hides the directory and leaderboard from a member whose paid access ended", () => {
    const ended = access("member", "public", me, false);
    expect(canListMembers(ended)).toBe(false);
    expect(canReadLeaderboard(ended)).toBe(false);
  });
});
