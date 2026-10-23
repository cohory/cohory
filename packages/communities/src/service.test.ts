import { ForbiddenError, UnauthenticatedError, type Actor } from "@cohory/authz";
import { newId } from "@cohory/db";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ApprovalRequiredError,
  CommunityArchivedError,
  CommunityCreationRestrictedError,
  CommunityNotFoundError,
  CommunityValidationError,
  InviteOnlyError,
  MembershipNotFoundError,
  OwnerCannotLeaveError,
  PaymentRequiredError,
  SlugReservedError,
  SlugTakenError,
} from "./errors";
import { createCommunitiesService, type CommunitiesService } from "./service";
import { createFakeRepository } from "./test/fake-repository";

const guest: Actor = { kind: "guest" };

function user(userId = newId()): Actor & { kind: "user" } {
  return { kind: "user", userId, platformAdmin: false };
}

let repo: ReturnType<typeof createFakeRepository>;
let service: CommunitiesService;

beforeEach(() => {
  repo = createFakeRepository();
  service = createCommunitiesService(repo);
});

describe("createCommunity", () => {
  it("creates the community with the actor as active owner", async () => {
    const owner = user();

    const result = await service.createCommunity(owner, {
      name: "Makers",
      slug: "makers",
      description: "Build things",
      privacy: "public",
    });

    expect(result.community).toMatchObject({
      slug: "makers",
      name: "Makers",
      description: "Build things",
      privacy: "public",
    });
    expect(result.membership).toMatchObject({
      communityId: result.community.id,
      userId: owner.userId,
      role: "owner",
      status: "active",
    });
  });

  describe("when only operators may create communities", () => {
    const operators = { mode: "operators", operators: ["owner@example.com"] } as const;

    it("refuses a person who is not on the operator list", async () => {
      const member = user();
      repo.addUser(member.userId, "Mia", undefined, "member@example.com");
      const restricted = createCommunitiesService(repo, { communityCreation: operators });

      const attempt = restricted.createCommunity(member, { name: "Spam", slug: "spam" });

      await expect(attempt).rejects.toBeInstanceOf(CommunityCreationRestrictedError);
      await expect(attempt).rejects.toMatchObject({ code: "community_creation_restricted" });
      await expect(restricted.getCommunityBySlug(guest, "spam")).rejects.toBeInstanceOf(
        CommunityNotFoundError,
      );
    });

    it("lets a listed operator create one whatever the case of the address", async () => {
      const owner = user();
      repo.addUser(owner.userId, "Olga", undefined, "Owner@Example.com");
      const restricted = createCommunitiesService(repo, { communityCreation: operators });

      const result = await restricted.createCommunity(owner, { name: "Home", slug: "home-base" });

      expect(result.membership.role).toBe("owner");
    });

    it("refuses an operator address that the account has not confirmed", async () => {
      const claimant = user();
      repo.addUser(claimant.userId, "Olga", undefined, "owner@example.com", false);
      const restricted = createCommunitiesService(repo, { communityCreation: operators });

      await expect(
        restricted.createCommunity(claimant, { name: "Home", slug: "home-base" }),
      ).rejects.toBeInstanceOf(CommunityCreationRestrictedError);
    });
  });

  it("defaults to a private community without a description", async () => {
    const result = await service.createCommunity(user(), { name: "Quiet", slug: "quiet" });

    expect(result.community.privacy).toBe("private");
    expect(result.community.description).toBeNull();
  });

  it("reviews join requests in a new private community and opens a new public one", async () => {
    const quiet = await service.createCommunity(user(), { name: "Quiet", slug: "quiet" });
    const loud = await service.createCommunity(user(), {
      name: "Loud",
      slug: "loud",
      privacy: "public",
    });

    expect(quiet.community.joinMode).toBe("approval");
    expect(loud.community.joinMode).toBe("open");
  });

  it("requires a signed in actor", async () => {
    await expect(service.createCommunity(guest, { name: "X", slug: "xyz" })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it.each(["api", "docs", "admin", "manage", "sign-in", "new"])(
    "rejects the reserved slug %s",
    async (slug) => {
      await expect(service.createCommunity(user(), { name: "Taken", slug })).rejects.toBeInstanceOf(
        SlugReservedError,
      );
    },
  );

  it("rejects a slug that is already taken", async () => {
    await service.createCommunity(user(), { name: "One", slug: "shared" });

    await expect(
      service.createCommunity(user(), { name: "Two", slug: "shared" }),
    ).rejects.toBeInstanceOf(SlugTakenError);
  });

  it.each([
    { name: "", slug: "valid-slug" },
    { name: "Valid", slug: "No Caps" },
    { name: "Valid", slug: "ab" },
  ])("rejects invalid input %o", async (input) => {
    await expect(service.createCommunity(user(), input)).rejects.toBeInstanceOf(
      CommunityValidationError,
    );
  });
});

describe("getCommunityBySlug", () => {
  it("returns a public community to a guest", async () => {
    repo.addCommunity({ slug: "open-house", privacy: "public", name: "Open" });

    const community = await service.getCommunityBySlug(guest, "open-house");

    expect(community).toMatchObject({ slug: "open-house", name: "Open", privacy: "public" });
  });

  it("shows only the limited About view of a private community to a signed out guest", async () => {
    const community = repo.addCommunity({
      slug: "inner-circle",
      name: "Inner",
      description: "Quiet",
      appearance: { coverKey: "communities/inner/branding/cover.png" },
    });
    repo.addMembership({ communityId: community.id, userId: newId(), role: "owner" });

    const view = await service.getCommunityBySlug(guest, "inner-circle");

    expect(view).toEqual({
      access: "limited",
      id: community.id,
      slug: "inner-circle",
      name: "Inner",
      description: "Quiet",
      privacy: "private",
      joinMode: "open",
      joinQuestions: [],
      coverUrl: "/api/uploads/communities/inner/branding/cover.png",
      memberCount: 1,
      detailedDescription: null,
      refundPolicy: null,
    });
  });

  it("shows only the limited view of a private community to a signed in non member", async () => {
    repo.addCommunity({ slug: "inner-circle" });

    expect((await service.getCommunityBySlug(user(), "inner-circle")).access).toBe("limited");
  });

  it.each(["banned", "pending", "removed"] as const)(
    "shows only the limited view of a private community to a %s person",
    async (status) => {
      const actor = user();
      const community = repo.addCommunity({ slug: "inner-circle" });
      repo.addMembership({ communityId: community.id, userId: actor.userId, status });

      expect((await service.getCommunityBySlug(actor, "inner-circle")).access).toBe("limited");
    },
  );

  it("shows the full view of a private community to an active member", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "inner-circle" });
    repo.addMembership({ communityId: community.id, userId: actor.userId });

    const view = await service.getCommunityBySlug(actor, "inner-circle");

    expect(view).toMatchObject({ access: "full", id: community.id, memberCount: 1 });
  });

  it("counts only active members", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    repo.addMembership({ communityId: community.id, userId: newId(), role: "owner" });
    repo.addMembership({ communityId: community.id, userId: newId() });
    repo.addMembership({ communityId: community.id, userId: newId(), status: "removed" });

    expect((await service.getCommunityBySlug(guest, "open-house")).memberCount).toBe(2);
  });

  it.each(["missing-one", "NOT A SLUG"])("answers not found for %s", async (slug) => {
    await expect(service.getCommunityBySlug(guest, slug)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("does not expose internal fields in the full view", async () => {
    repo.addCommunity({ slug: "open-house", privacy: "public" });

    const community = await service.getCommunityBySlug(guest, "open-house");

    expect(Object.keys(community).sort()).toEqual(
      [
        "access",
        "archivedAt",
        "coverUrl",
        "createdAt",
        "description",
        "detailedDescription",
        "id",
        "joinMode",
        "joinQuestions",
        "memberCount",
        "name",
        "privacy",
        "refundPolicy",
        "slug",
      ].sort(),
    );
  });

  it("exposes only the join prompt and no dates in the limited view", async () => {
    repo.addCommunity({
      slug: "inner-circle",
      joinMode: "approval",
      joinQuestions: [{ text: "Why join?", required: true }],
    });

    const community = await service.getCommunityBySlug(guest, "inner-circle");

    expect(Object.keys(community).sort()).toEqual(
      [
        "access",
        "coverUrl",
        "description",
        "detailedDescription",
        "id",
        "joinMode",
        "joinQuestions",
        "memberCount",
        "name",
        "privacy",
        "refundPolicy",
        "slug",
      ].sort(),
    );
    expect(community).toMatchObject({
      joinMode: "approval",
      joinQuestions: [{ text: "Why join?", required: true }],
    });
  });
});

describe("searchMembersByName", () => {
  it("finds active members whose name starts with the prefix, owner first", async () => {
    const owner = user();
    const member = user();
    const community = repo.addCommunity({ slug: "inner-circle" });
    repo.addUser(owner.userId, "Ana Lopez", "/api/uploads/avatars/ana.png");
    repo.addUser(member.userId, "Anabel Ruiz");
    const other = newId();
    repo.addUser(other, "Ben Ito");
    repo.addMembership({ communityId: community.id, userId: member.userId });
    repo.addMembership({ communityId: community.id, userId: owner.userId, role: "owner" });
    repo.addMembership({ communityId: community.id, userId: other });
    const removed = newId();
    repo.addUser(removed, "Anastasia");
    repo.addMembership({ communityId: community.id, userId: removed, status: "removed" });

    const members = await service.searchMembersByName(member, community.id, {
      prefix: "ana",
      limit: 8,
    });

    expect(members).toEqual([
      expect.objectContaining({
        userId: owner.userId,
        name: "Ana Lopez",
        image: "/api/uploads/avatars/ana.png",
        role: "owner",
      }),
      expect.objectContaining({ userId: member.userId, name: "Anabel Ruiz", role: "member" }),
    ]);
  });

  it("returns at most the requested number of members", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "inner-circle" });
    repo.addUser(actor.userId, "Sam 0");
    repo.addMembership({ communityId: community.id, userId: actor.userId });
    for (let i = 1; i < 5; i += 1) {
      const id = newId();
      repo.addUser(id, `Sam ${i}`);
      repo.addMembership({ communityId: community.id, userId: id });
    }

    expect(
      await service.searchMembersByName(actor, community.id, { prefix: "sam", limit: 3 }),
    ).toHaveLength(3);
  });

  it("rejects an empty prefix or an unbounded limit", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "inner-circle" });
    repo.addMembership({ communityId: community.id, userId: actor.userId });

    await expect(
      service.searchMembersByName(actor, community.id, { prefix: "", limit: 8 }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      service.searchMembersByName(actor, community.id, { prefix: "a", limit: 1000 }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it.each(["admin", "moderator"] as const)("lets a %s search members", async (role) => {
    const actor = user();
    const community = repo.addCommunity({ slug: "inner-circle" });
    repo.addUser(actor.userId, "Pat");
    repo.addMembership({ communityId: community.id, userId: actor.userId, role });

    expect(
      await service.searchMembersByName(actor, community.id, { prefix: "pat", limit: 8 }),
    ).toHaveLength(1);
  });

  it("refuses a non member of a public community", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(
      service.searchMembersByName(user(), community.id, { prefix: "a", limit: 8 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a guest on a public community", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(
      service.searchMembersByName(guest, community.id, { prefix: "a", limit: 8 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("answers not found for a private community the actor is not in", async () => {
    const community = repo.addCommunity({ slug: "inner-circle" });

    await expect(
      service.searchMembersByName(user(), community.id, { prefix: "a", limit: 8 }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("answers not found to a member of another community", async () => {
    const actor = user();
    const mine = repo.addCommunity({ slug: "mine" });
    const theirs = repo.addCommunity({ slug: "theirs" });
    repo.addMembership({ communityId: mine.id, userId: actor.userId });

    await expect(
      service.searchMembersByName(actor, theirs.id, { prefix: "a", limit: 8 }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });
});

describe("listCommunitiesForUser", () => {
  it("lists only the actor's active memberships", async () => {
    const actor = user();
    const a = repo.addCommunity({ slug: "alpha" });
    const b = repo.addCommunity({ slug: "bravo" });
    const c = repo.addCommunity({ slug: "charlie" });
    repo.addMembership({ communityId: a.id, userId: actor.userId });
    repo.addMembership({ communityId: b.id, userId: newId() });
    repo.addMembership({ communityId: c.id, userId: actor.userId, status: "removed" });

    const rows = await service.listCommunitiesForUser(actor);

    expect(rows.map((r) => r.community.slug)).toEqual(["alpha"]);
    expect(rows[0]?.membership.role).toBe("member");
    expect(rows[0]?.community.memberCount).toBe(1);
  });

  it("requires a signed in actor", async () => {
    await expect(service.listCommunitiesForUser(guest)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe("joinCommunity", () => {
  describe("with a fair use member limit", () => {
    const fairUse = parseFairUseEnv({ COHORY_EDITION: "cloud", FAIR_USE_MEMBERS: "2" });

    it("refuses a new member once the limit is reached and keeps existing members", async () => {
      const limited = createCommunitiesService(repo, { fairUse });
      const community = repo.addCommunity({ slug: "full-house", privacy: "public" });
      const first = user();
      const second = user();
      await limited.joinCommunity(first, community.id);
      await limited.joinCommunity(second, community.id);

      await expect(limited.joinCommunity(user(), community.id)).rejects.toMatchObject({
        constructor: LimitReachedError,
        resource: "members",
        limit: 2,
        used: 2,
      });
      expect((await limited.joinCommunity(first, community.id)).status).toBe("active");
    });

    it("counts only active members toward the limit", async () => {
      const limited = createCommunitiesService(repo, { fairUse });
      const community = repo.addCommunity({ slug: "turnover", privacy: "public" });
      const leaver = user();
      await limited.joinCommunity(leaver, community.id);
      await limited.joinCommunity(user(), community.id);
      await limited.leaveCommunity(leaver, community.id);

      expect((await limited.joinCommunity(user(), community.id)).status).toBe("active");
    });
  });

  it("adds an active member to an open public community", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    const membership = await service.joinCommunity(actor, community.id);

    expect(membership).toMatchObject({
      communityId: community.id,
      userId: actor.userId,
      role: "member",
      status: "active",
    });
  });

  it("is idempotent for an existing member", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    const first = await service.joinCommunity(actor, community.id);
    const second = await service.joinCommunity(actor, community.id);

    expect(second.id).toBe(first.id);
  });

  it("returns the owner's membership unchanged when the owner joins", async () => {
    const owner = user();
    const { community } = await service.createCommunity(owner, { name: "Mine", slug: "mine" });

    expect((await service.joinCommunity(owner, community.id)).role).toBe("owner");
  });

  it("reactivates a person who left", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    repo.addMembership({ communityId: community.id, userId: actor.userId, status: "removed" });

    expect((await service.joinCommunity(actor, community.id)).status).toBe("active");
  });

  it("refuses a banned person", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    repo.addMembership({ communityId: community.id, userId: actor.userId, status: "banned" });

    await expect(service.joinCommunity(actor, community.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a new account that uses a banned email", async () => {
    const banned = user();
    const returning = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    repo.addMembership({
      communityId: community.id,
      userId: banned.userId,
      status: "banned",
      bannedEmail: "Ban@Example.test",
    });
    repo.addUser(returning.userId, "Returning", undefined, "ban@example.test");

    await expect(service.joinCommunity(returning, community.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses to join an archived community", async () => {
    const community = repo.addCommunity({
      slug: "open-house",
      privacy: "public",
      archivedAt: new Date(),
    });

    await expect(service.joinCommunity(user(), community.id)).rejects.toBeInstanceOf(
      CommunityArchivedError,
    );
  });

  it("lets a signed in person join a private community with open join", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "inner-circle", joinMode: "open" });

    const membership = await service.joinCommunity(actor, community.id);

    expect(membership).toMatchObject({ userId: actor.userId, role: "member", status: "active" });
  });

  it("answers not found for an unknown community", async () => {
    await expect(service.joinCommunity(user(), newId())).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it.each(["public", "private"] as const)(
    "asks for a join request in a %s community that needs approval",
    async (privacy) => {
      const community = repo.addCommunity({ slug: "gated", privacy, joinMode: "approval" });

      await expect(service.joinCommunity(user(), community.id)).rejects.toBeInstanceOf(
        ApprovalRequiredError,
      );
      expect(await repo.countActiveMembers(community.id)).toBe(0);
    },
  );

  it.each(["public", "private"] as const)(
    "refuses open join in a %s invite only community",
    async (privacy) => {
      const community = repo.addCommunity({ slug: "invited", privacy, joinMode: "invite" });

      await expect(service.joinCommunity(user(), community.id)).rejects.toBeInstanceOf(
        InviteOnlyError,
      );
    },
  );

  it("refuses a guest in every join mode", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.joinCommunity(guest, community.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("asks for payment instead of joining a paid community for free", async () => {
    const community = repo.addCommunity({ slug: "paid", privacy: "public", currency: "usd" });

    await expect(service.joinCommunity(user(), community.id)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
  });

  it("requires a signed in actor", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.joinCommunity(guest, community.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe("leaveCommunity", () => {
  it("marks the membership removed", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    await service.joinCommunity(actor, community.id);

    expect((await service.leaveCommunity(actor, community.id)).status).toBe("removed");
    expect(await service.listCommunitiesForUser(actor)).toEqual([]);
  });

  it("refuses the owner", async () => {
    const owner = user();
    const { community } = await service.createCommunity(owner, { name: "Mine", slug: "mine" });

    await expect(service.leaveCommunity(owner, community.id)).rejects.toBeInstanceOf(
      OwnerCannotLeaveError,
    );
  });

  it("answers not found for a public community the actor is not in", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.leaveCommunity(user(), community.id)).rejects.toBeInstanceOf(
      MembershipNotFoundError,
    );
  });

  it("requires a signed in actor", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.leaveCommunity(guest, community.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe("getMembership", () => {
  it("returns the actor's membership", async () => {
    const actor = user();
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    await service.joinCommunity(actor, community.id);

    expect((await service.getMembership(actor, community.id))?.userId).toBe(actor.userId);
  });

  it("returns null for a non member of a public community", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    expect(await service.getMembership(user(), community.id)).toBeNull();
  });

  it("answers not found for a private community the actor is not in", async () => {
    const community = repo.addCommunity({ slug: "inner-circle" });

    await expect(service.getMembership(user(), community.id)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("requires a signed in actor", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.getMembership(guest, community.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe("getAbout", () => {
  it("returns the gallery, owner, admin count, and avatars to a visitor of a private community", async () => {
    const community = repo.addCommunity({ slug: "about", privacy: "private" });
    const owner = user();
    const admin = user();
    repo.addUser(owner.userId, "Olive", "https://img.test/o.png");
    repo.addUser(admin.userId, "Ada");
    repo.addMembership({ communityId: community.id, userId: owner.userId, role: "owner" });
    repo.addMembership({ communityId: community.id, userId: admin.userId, role: "admin" });
    repo.addMembership({ communityId: community.id, userId: newId(), role: "moderator" });
    repo.addGalleryItem({
      communityId: community.id,
      kind: "video_embed",
      embedUrl: "https://player.vimeo.com/video/76979871",
    });
    repo.addGalleryItem({
      communityId: community.id,
      kind: "image",
      storageKey: `communities/${community.id}/gallery/a.png`,
      altText: "Meetup",
    });

    const about = await service.getAbout(guest, community.id);

    expect(about.owner).toEqual({ name: "Olive", image: "https://img.test/o.png" });
    expect(about.adminCount).toBe(2);
    expect(about.avatars).toHaveLength(3);
    expect(about.gallery).toEqual([
      {
        id: expect.any(String),
        kind: "video_embed",
        provider: "vimeo",
        url: "https://player.vimeo.com/video/76979871",
        thumbnailUrl: null,
        altText: null,
        position: 0,
      },
      {
        id: expect.any(String),
        kind: "image",
        url: `/api/uploads/communities/${community.id}/gallery/a.png`,
        altText: "Meetup",
        position: 1,
      },
    ]);
  });

  it("skips stored video URLs that are not normalized embed URLs", async () => {
    const community = repo.addCommunity({ slug: "about-skip", privacy: "public" });
    repo.addGalleryItem({
      communityId: community.id,
      kind: "video_embed",
      embedUrl: "https://evil.example/embed/abcdefgh",
    });

    expect((await service.getAbout(guest, community.id)).gallery).toEqual([]);
  });

  it("answers not found for an unknown community", async () => {
    await expect(service.getAbout(guest, newId())).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("exposes the stored detailed description on the community views", async () => {
    const detailedDescription = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }],
    };
    repo.addCommunity({ slug: "described", privacy: "private", detailedDescription });

    const view = await service.getCommunityBySlug(guest, "described");

    expect(view.access).toBe("limited");
    expect(view.detailedDescription).toEqual(detailedDescription);
  });
});

describe("getAccess", () => {
  it("returns the member's membership, role, and entitlement in one call", async () => {
    const { community } = await service.createCommunity(user(), {
      name: "Access",
      slug: "access",
      privacy: "public",
    });
    const joiner = user();
    await service.joinCommunity(joiner, community.id);

    expect(await service.getAccess(joiner, community.id)).toMatchObject({
      role: "member",
      entitled: true,
      membership: { userId: joiner.userId, status: "active" },
    });
  });

  it("gives a guest no membership, role, or entitlement", async () => {
    const { community } = await service.createCommunity(user(), {
      name: "Open",
      slug: "open",
      privacy: "public",
    });

    expect(await service.getAccess(guest, community.id)).toEqual({
      role: null,
      entitled: false,
      membership: null,
      onboardingDismissed: false,
    });
  });
});

describe("dismissOnboarding", () => {
  it("hides the welcome card for this member only", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    const dismisser = user();
    const other = user();
    await service.joinCommunity(dismisser, community.id);
    await service.joinCommunity(other, community.id);

    await service.dismissOnboarding(dismisser, community.id);

    expect((await service.getAccess(dismisser, community.id)).onboardingDismissed).toBe(true);
    expect((await service.getAccess(other, community.id)).onboardingDismissed).toBe(false);
  });

  it("refuses someone who is not an active member", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });
    const leaver = user();
    await service.joinCommunity(leaver, community.id);
    await service.leaveCommunity(leaver, community.id);

    await expect(service.dismissOnboarding(leaver, community.id)).rejects.toBeInstanceOf(
      MembershipNotFoundError,
    );
    await expect(service.dismissOnboarding(user(), community.id)).rejects.toBeInstanceOf(
      MembershipNotFoundError,
    );
  });

  it("answers not found for a private community the actor is not in", async () => {
    const community = repo.addCommunity({ slug: "inner-circle" });

    await expect(service.dismissOnboarding(user(), community.id)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("requires a signed in actor", async () => {
    const community = repo.addCommunity({ slug: "open-house", privacy: "public" });

    await expect(service.dismissOnboarding(guest, community.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
