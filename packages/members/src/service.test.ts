import {
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
} from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MemberNotFoundError,
  MembersValidationError,
  UsernameReservedError,
  UsernameTakenError,
} from "./errors";
import { createMembersService, type MembersService } from "./service";
import { createFakeMembersRepository, type FakeMembersRepository } from "./test/fake-repository";

let repo: FakeMembersRepository;
let service: MembersService;
let communityId: string;

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

beforeEach(() => {
  repo = createFakeMembersRepository();
  service = createMembersService(repo);
  communityId = repo.addCommunity({ levelNames: ["Newcomer", "Member"] });
});

describe("searchMembers", () => {
  it.each<CommunityRole>(["member", "moderator", "admin", "owner"])(
    "lets a %s list the directory with level names",
    async (role) => {
      const viewer = repo.addMember(communityId, { role, name: "Viewer" });
      repo.addMember(communityId, { name: "Ada", points: 12, level: 2 });

      const page = await service.searchMembers(user(viewer), communityId, { query: "ad" });

      expect(page.data).toEqual([
        expect.objectContaining({ name: "Ada", points: 12, level: 2, levelName: "Member" }),
      ]);
    },
  );

  it("hides the directory of a private community from people who are not members", async () => {
    const stranger = repo.addUser();
    const pending = repo.addMember(communityId, { status: "pending" });

    for (const actor of [user(stranger), user(pending), { kind: "guest" } as const]) {
      await expect(service.searchMembers(actor, communityId, {})).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    }
  });

  it("denies the directory of a public community to non members", async () => {
    const publicId = repo.addCommunity({ privacy: "public" });

    await expect(service.searchMembers({ kind: "guest" }, publicId, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("filters by level and pages with a cursor", async () => {
    const viewer = repo.addMember(communityId);
    for (let i = 0; i < 5; i += 1) {
      repo.addMember(communityId, { level: 3, points: 40 });
    }

    const first = await service.searchMembers(user(viewer), communityId, { level: 3, limit: 3 });
    const second = await service.searchMembers(user(viewer), communityId, {
      level: 3,
      limit: 3,
      cursor: first.nextCursor,
    });

    expect(first.data).toHaveLength(3);
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((m) => m.userId)).size).toBe(5);
  });

  it("lists each member with their bio so the directory can start conversations", async () => {
    const viewer = repo.addMember(communityId);
    const potter = repo.addMember(communityId, { name: "Potter" });
    await service.updateMyProfile(user(potter), communityId, { bio: "Throws pots in Lisbon." });

    const page = await service.searchMembers(user(viewer), communityId, { query: "pot" });

    expect(page.data).toEqual([
      expect.objectContaining({ name: "Potter", bio: "Throws pots in Lisbon." }),
    ]);
  });

  it("hides points and levels when gamification is off", async () => {
    const off = repo.addCommunity({ gamificationEnabled: false });
    const viewer = repo.addMember(off, { points: 50, level: 3 });

    const page = await service.searchMembers(user(viewer), off, {});

    expect(page.data[0]).toMatchObject({ points: null, level: null, levelName: null });
  });

  it("rejects a malformed cursor and an out of range level", async () => {
    const viewer = repo.addMember(communityId);

    await expect(
      service.searchMembers(user(viewer), communityId, { cursor: "nope" }),
    ).rejects.toBeInstanceOf(MembersValidationError);
    await expect(
      service.searchMembers(user(viewer), communityId, { level: 10 }),
    ).rejects.toBeInstanceOf(MembersValidationError);
  });
});

describe("getMemberProfile", () => {
  it("returns the profile of an active member", async () => {
    const viewer = repo.addMember(communityId);
    const ada = repo.addMember(communityId, { name: "Ada" });
    await service.updateMyProfile(user(ada), communityId, { bio: "Builds things" });

    const profile = await service.getMemberProfile(user(viewer), communityId, ada);

    expect(profile).toMatchObject({ name: "Ada", bio: "Builds things", level: 1 });
    expect(profile.recentActivity).toEqual({ posts: [], comments: [] });
  });

  it("answers not found for removed members, unknown ids, and other communities", async () => {
    const viewer = repo.addMember(communityId);
    const gone = repo.addMember(communityId, { status: "removed" });
    const elsewhere = repo.addMember(repo.addCommunity());

    for (const id of [gone, elsewhere, newId(), "not-a-uuid"]) {
      await expect(service.getMemberProfile(user(viewer), communityId, id)).rejects.toBeInstanceOf(
        MemberNotFoundError,
      );
    }
  });
});

describe("updateMyProfile", () => {
  it("trims the bio and clears it when empty", async () => {
    const me = repo.addMember(communityId);

    await service.updateMyProfile(user(me), communityId, { bio: "  hi  " });
    expect(repo.bioOf(communityId, me)).toBe("hi");
    await service.updateMyProfile(user(me), communityId, { bio: "   " });
    expect(repo.bioOf(communityId, me)).toBeNull();
  });

  it("rejects a bio over 500 characters", async () => {
    const me = repo.addMember(communityId);

    await expect(
      service.updateMyProfile(user(me), communityId, { bio: "x".repeat(501) }),
    ).rejects.toBeInstanceOf(MembersValidationError);
  });

  it("requires an active membership", async () => {
    const publicId = repo.addCommunity({ privacy: "public" });
    const outsider = repo.addUser();

    await expect(
      service.updateMyProfile(user(outsider), publicId, { bio: "hi" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.updateMyProfile({ kind: "guest" }, publicId, { bio: "hi" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("setUsername", () => {
  it("normalizes to lowercase and saves it", async () => {
    const me = repo.addUser();

    expect(await service.setUsername(user(me), { username: "  Ada-Lovelace " })).toEqual({
      username: "ada-lovelace",
    });
    expect(repo.usernameOf(me)).toBe("ada-lovelace");
  });

  it.each(["ab", "a".repeat(31), "-ada", "ada-", "ad--a", "ada_l", "ada l", "ädä"])(
    "rejects %j",
    async (username) => {
      await expect(service.setUsername(user(repo.addUser()), { username })).rejects.toBeInstanceOf(
        MembersValidationError,
      );
    },
  );

  it("rejects reserved names and names someone else has", async () => {
    const first = repo.addUser();
    const second = repo.addUser();
    await service.setUsername(user(first), { username: "grace" });

    await expect(service.setUsername(user(second), { username: "Admin" })).rejects.toBeInstanceOf(
      UsernameReservedError,
    );
    await expect(service.setUsername(user(second), { username: "GRACE" })).rejects.toBeInstanceOf(
      UsernameTakenError,
    );
    await expect(service.setUsername(user(first), { username: "grace" })).resolves.toEqual({
      username: "grace",
    });
  });

  it("requires a signed in person", async () => {
    await expect(
      service.setUsername({ kind: "guest" }, { username: "ada" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("getGamificationSettings", () => {
  it("returns the toggle and level names to a member", async () => {
    const viewer = repo.addMember(communityId);

    await expect(service.getGamificationSettings(user(viewer), communityId)).resolves.toEqual({
      enabled: true,
      levelNames: ["Newcomer", "Member"],
    });
  });

  it("hides a private community from outsiders", async () => {
    await expect(
      service.getGamificationSettings(user(repo.addUser()), communityId),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("getMemberLevels", () => {
  it("returns levels of active members only, scoped to the community", async () => {
    const viewer = repo.addMember(communityId);
    const ada = repo.addMember(communityId, { level: 3, points: 40 });
    const gone = repo.addMember(communityId, { level: 2, status: "removed" });
    const elsewhere = repo.addMember(repo.addCommunity(), { level: 4 });

    const levels = await service.getMemberLevels(user(viewer), communityId, [
      ada,
      gone,
      elsewhere,
      viewer,
    ]);

    expect([...levels.entries()]).toEqual([
      [ada, 3],
      [viewer, 1],
    ]);
  });

  it("returns nothing when gamification is off or the list is empty", async () => {
    const off = repo.addCommunity({ gamificationEnabled: false });
    const viewer = repo.addMember(off, { level: 2 });

    const insider = repo.addMember(communityId);

    expect((await service.getMemberLevels(user(viewer), off, [viewer])).size).toBe(0);
    expect((await service.getMemberLevels(user(insider), communityId, [])).size).toBe(0);
  });

  it("denies people who cannot read the community", async () => {
    await expect(
      service.getMemberLevels(user(repo.addUser()), communityId, [repo.addUser()]),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("getMyUsername", () => {
  it("returns the signed in person's username or null", async () => {
    const me = repo.addUser();

    expect(await service.getMyUsername(user(me))).toBeNull();
    await service.setUsername(user(me), { username: "ada" });
    expect(await service.getMyUsername(user(me))).toBe("ada");
  });

  it("requires a signed in person", async () => {
    await expect(service.getMyUsername({ kind: "guest" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
