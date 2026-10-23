import { describe, expect, it } from "vitest";

import {
  createCreatorsInviteService,
  creatorsInviteLabel,
  creatorsInviteToken,
  type CreatedCommunityFacts,
  type CreatorFacts,
  type CreatorsCommunityFacts,
  type CreatorsInviteMessage,
  type CreatorsInviteServiceDeps,
  type CreatorsInviteStore,
  type CreatorsMembership,
  type NewCreatorsInvite,
} from "./service";

const secret = "test-secret-that-is-long-enough-for-hmac-000";
const creatorsId = "0199f000-0000-7000-8000-000000000001";
const createdId = "0199f000-0000-7000-8000-000000000002";
const otherCreatedId = "0199f000-0000-7000-8000-000000000003";
const creatorsOwner = "0199f000-0000-7000-8000-0000000000a1";
const ada = "0199f000-0000-7000-8000-0000000000b1";
const createdAt = new Date("2026-10-20T09:00:00.000Z");
const beforeDue = new Date("2026-10-23T08:59:59.000Z");
const due = new Date("2026-10-23T09:00:00.000Z");

const creatorsCommunity: CreatorsCommunityFacts = {
  id: creatorsId,
  slug: "cohory-creators",
  name: "Cohory Creators",
  ownerId: creatorsOwner,
  ownerName: "Riza",
  archived: false,
};

interface World {
  creators: CreatorsCommunityFacts | null;
  communities: Map<string, CreatedCommunityFacts>;
  people: Map<string, CreatorFacts>;
  memberships: Map<string, CreatorsMembership>;
  invites: Map<string, { communityId: string; invite: NewCreatorsInvite }>;
  optedOut: Set<string>;
  sent: CreatorsInviteMessage[];
  failSend: boolean;
}

function world(): World {
  return {
    creators: creatorsCommunity,
    communities: new Map([
      [createdId, { id: createdId, createdAt, ownerId: ada }],
      [otherCreatedId, { id: otherCreatedId, createdAt, ownerId: ada }],
    ]),
    people: new Map([
      [ada, { name: "Ada", email: "ada@example.test", emailVerified: true, closing: false }],
    ]),
    memberships: new Map(),
    invites: new Map(),
    optedOut: new Set(),
    sent: [],
    failSend: false,
  };
}

function storeOf(w: World): CreatorsInviteStore {
  return {
    findCreatorsCommunity: async (slug) => (w.creators?.slug === slug ? w.creators : null),
    findCreatedCommunity: async (id) => w.communities.get(id) ?? null,
    findCreator: async (userId) => w.people.get(userId) ?? null,
    findMembership: async (communityId, userId) =>
      w.memberships.get(`${communityId}:${userId}`) ?? null,
    inviteExists: async (token) => w.invites.has(token),
    async insertInvite(communityId, invite, deliver) {
      if (w.invites.has(invite.token)) {
        return false;
      }
      await deliver();
      w.invites.set(invite.token, { communityId, invite });
      return true;
    },
  };
}

function service(w: World, overrides: Partial<CreatorsInviteServiceDeps> = {}, at = due) {
  return createCreatorsInviteService({
    store: storeOf(w),
    creatorsSlug: "cohory-creators",
    secret,
    appUrl: "https://cohory.test/",
    isOptedOut: async (email, communityId) => w.optedOut.has(`${communityId}:${email}`),
    send: async (message) => {
      if (w.failSend) {
        throw new Error("smtp down");
      }
      w.sent.push(message);
    },
    now: () => at,
    ...overrides,
  });
}

describe("creators invite timing", () => {
  it("waits for 3 days after the community was created when nothing was published", async () => {
    const w = world();
    expect(
      await service(w, {}, beforeDue).inviteCreator({ communityId: createdId, trigger: "created" }),
    ).toBe("not_due");
    expect(w.sent).toEqual([]);
  });

  it("invites 3 days after the community was created", async () => {
    const w = world();
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "created" })).toBe(
      "sent",
    );
    expect(w.sent).toHaveLength(1);
  });

  it("invites right after the first published post, before the 3 days are up", async () => {
    const w = world();
    expect(
      await service(w, {}, beforeDue).inviteCreator({ communityId: createdId, trigger: "post" }),
    ).toBe("sent");
  });

  it("invites right after the first published course, before the 3 days are up", async () => {
    const w = world();
    expect(
      await service(w, {}, beforeDue).inviteCreator({ communityId: createdId, trigger: "course" }),
    ).toBe("sent");
  });

  it("sends an accept link that joins the creators community, from its owner", async () => {
    const w = world();
    await service(w).inviteCreator({ communityId: createdId, trigger: "post" });
    const token = creatorsInviteToken(secret, ada);
    expect(w.sent[0]).toEqual({
      to: "ada@example.test",
      name: "Ada",
      inviterName: "Riza",
      community: {
        id: creatorsId,
        slug: "cohory-creators",
        name: "Cohory Creators",
      },
      url: `https://cohory.test/join/${token}`,
      expiresAt: new Date("2026-11-22T09:00:00.000Z"),
    });
    expect(w.invites.get(token)).toEqual({
      communityId: creatorsId,
      invite: {
        token,
        createdBy: creatorsOwner,
        expiresAt: new Date("2026-11-22T09:00:00.000Z"),
        label: creatorsInviteLabel,
      },
    });
  });
});

describe("creators invite once per person", () => {
  it("does not invite again when the same community triggers twice", async () => {
    const w = world();
    const invite = service(w);
    expect(await invite.inviteCreator({ communityId: createdId, trigger: "post" })).toBe("sent");
    expect(await invite.inviteCreator({ communityId: createdId, trigger: "created" })).toBe(
      "already_invited",
    );
    expect(w.sent).toHaveLength(1);
  });

  it("does not invite again for a second community the same person created", async () => {
    const w = world();
    const invite = service(w);
    await invite.inviteCreator({ communityId: createdId, trigger: "post" });
    expect(await invite.inviteCreator({ communityId: otherCreatedId, trigger: "course" })).toBe(
      "already_invited",
    );
    expect(w.sent).toHaveLength(1);
  });

  it("reports already invited when a concurrent job stored the invite first", async () => {
    const w = world();
    const store = storeOf(w);
    const racing = service(w, {
      store: { ...store, inviteExists: async () => false, insertInvite: async () => false },
    });
    expect(await racing.inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "already_invited",
    );
    expect(w.sent).toEqual([]);
  });

  it("keeps no invite when the email could not be sent, so a retry sends it", async () => {
    const w = world();
    w.failSend = true;
    await expect(
      service(w).inviteCreator({ communityId: createdId, trigger: "post" }),
    ).rejects.toThrow("smtp down");
    expect(w.invites.size).toBe(0);
    w.failSend = false;
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "sent",
    );
  });
});

describe("creators invite skips", () => {
  it("sends nothing when CREATORS_COMMUNITY_SLUG is unset", async () => {
    const w = world();
    expect(
      await service(w, { creatorsSlug: null }).inviteCreator({
        communityId: createdId,
        trigger: "post",
      }),
    ).toBe("disabled");
    expect(w.sent).toEqual([]);
    expect(w.invites.size).toBe(0);
  });

  it("sends nothing when the creators community does not exist", async () => {
    const w = world();
    w.creators = null;
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "creators_unavailable",
    );
  });

  it("sends nothing when the creators community is archived", async () => {
    const w = world();
    w.creators = { ...creatorsCommunity, archived: true };
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "creators_unavailable",
    );
  });

  it("skips the creators community itself", async () => {
    const w = world();
    w.communities.set(creatorsId, { id: creatorsId, createdAt, ownerId: creatorsOwner });
    expect(await service(w).inviteCreator({ communityId: creatorsId, trigger: "post" })).toBe(
      "creators_community",
    );
  });

  it("skips a community that no longer exists", async () => {
    const w = world();
    w.communities.delete(createdId);
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "community_unavailable",
    );
  });

  it("skips the owner of the creators community", async () => {
    const w = world();
    w.communities.set(createdId, { id: createdId, createdAt, ownerId: creatorsOwner });
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "creators_owner",
    );
  });

  it("skips a creator who is already a member", async () => {
    const w = world();
    w.memberships.set(`${creatorsId}:${ada}`, "active");
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "member",
    );
  });

  it("skips a creator who is banned from the creators community", async () => {
    const w = world();
    w.memberships.set(`${creatorsId}:${ada}`, "banned");
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "banned",
    );
  });

  it("invites a creator who left the creators community or has a pending request", async () => {
    const w = world();
    w.memberships.set(`${creatorsId}:${ada}`, "other");
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "sent",
    );
  });

  it("skips a creator whose email address is unconfirmed", async () => {
    const w = world();
    w.people.set(ada, {
      name: "Ada",
      email: "ada@example.test",
      emailVerified: false,
      closing: false,
    });
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "unconfirmed",
    );
  });

  it("skips a creator who opted out of email from the creators community or the server", async () => {
    const w = world();
    w.optedOut.add(`${creatorsId}:ada@example.test`);
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "opted_out",
    );
  });

  it("skips a creator whose account is being deleted", async () => {
    const w = world();
    w.people.set(ada, {
      name: "Ada",
      email: "ada@example.test",
      emailVerified: true,
      closing: true,
    });
    expect(await service(w).inviteCreator({ communityId: createdId, trigger: "post" })).toBe(
      "account_closing",
    );
  });

  it("records nothing for a skipped creator, so a later trigger can still invite", async () => {
    const w = world();
    w.people.set(ada, {
      name: "Ada",
      email: "ada@example.test",
      emailVerified: false,
      closing: false,
    });
    await service(w).inviteCreator({ communityId: createdId, trigger: "post" });
    expect(w.invites.size).toBe(0);
    w.people.set(ada, {
      name: "Ada",
      email: "ada@example.test",
      emailVerified: true,
      closing: false,
    });
    expect(await service(w).inviteCreator({ communityId: otherCreatedId, trigger: "post" })).toBe(
      "sent",
    );
  });

  it("rejects a malformed job payload", async () => {
    await expect(
      service(world()).inviteCreator({ communityId: "nope", trigger: "post" }),
    ).rejects.toThrow();
  });
});

describe("creatorsInviteToken", () => {
  it("is a 43 character invite token that only the secret can produce", () => {
    const token = creatorsInviteToken(secret, ada);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(creatorsInviteToken(secret, ada)).toBe(token);
    expect(creatorsInviteToken(`${secret}x`, ada)).not.toBe(token);
    expect(creatorsInviteToken(secret, creatorsOwner)).not.toBe(token);
  });
});
