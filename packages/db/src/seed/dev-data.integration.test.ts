import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { newId } from "../ids";
import { getCommunityBySlug } from "../repositories/communities";
import { listMembershipsForCommunity } from "../repositories/memberships";
import { accounts, inviteLinks, membershipPlans, paymentConnections, users } from "../schema";
import { withCommunity } from "../tenancy/scope";
import { openTestDb, uniqueSlug } from "../test/fixtures";
import {
  devAdmin,
  devCreators,
  devMember,
  devPaidSeed,
  devSeed,
  devUser,
  seedDevData,
  seedDevDataWith,
  type DevSeedConfig,
} from "./dev-data";

const { db, close } = openTestDb();

afterAll(async () => {
  await close();
});

describe("seedDevData", () => {
  it("creates the private Cohory Creators community with an owner, an admin, members, and a user who has not joined, then is a no op", async () => {
    await seedDevData(db);
    const second = await seedDevData(db);

    expect(second).toEqual({
      userCreated: false,
      communityCreated: false,
      membershipCreated: false,
      usersCreated: 0,
      membersCreated: 0,
      inviteCreated: false,
      paidCommunityCreated: false,
      paidMembersCreated: 0,
      paidInviteCreated: false,
    });

    const invites = await db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.token, devSeed.inviteToken));
    expect(invites).toHaveLength(1);
    expect(devSeed.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const matchingUsers = await db.select().from(users).where(eq(users.email, devSeed.email));
    expect(matchingUsers).toHaveLength(1);
    const [user] = matchingUsers;
    if (!user) {
      throw new Error("dev user missing");
    }
    const credentials = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(credentials).toMatchObject([{ providerId: "credential", accountId: user.id }]);

    const community = await getCommunityBySlug(db, devSeed.communitySlug);
    if (!community) {
      throw new Error("dev community missing");
    }
    const members = await listMembershipsForCommunity(withCommunity(db, community.id));
    expect(user.username).toBe(devSeed.username);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: user.id, role: "owner", status: "active" }),
      ]),
    );
    expect(members.filter((member) => member.role === "owner")).toHaveLength(1);
    expect(community).toMatchObject({
      name: "Cohory Creators",
      privacy: "private",
      joinMode: "approval",
    });
    expect(user).toMatchObject({ name: "Riza", username: "riza" });

    const people = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(inArray(users.email, [devAdmin.email, devMember.email, devUser.email]));
    const roleOf = (email: string) => {
      const person = people.find((row) => row.email === email);
      return members.find((member) => member.userId === person?.id)?.role ?? "none";
    };
    expect(people).toHaveLength(3);
    expect(people.find((row) => row.email === devAdmin.email)?.username).toBe(devAdmin.username);
    expect(roleOf(devAdmin.email)).toBe("admin");
    expect(roleOf(devMember.email)).toBe("member");
    expect(roleOf(devUser.email)).toBe("none");

    const creators = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(
          users.email,
          devCreators.map((creator) => creator.email),
        ),
      );
    const creatorIds = new Set(creators.map((creator) => creator.id));
    const creatorMembers = members.filter((member) => creatorIds.has(member.userId));
    expect(creatorMembers).toHaveLength(devCreators.length);
    expect(creatorMembers.every((member) => member.role === "member")).toBe(true);
    expect(creatorMembers.every((member) => (member.joinAnswers ?? []).length === 3)).toBe(true);
  });

  it("creates the private Cohory Pro community with the owner, the dev member, an invite link, and no payments", async () => {
    await seedDevData(db);

    const community = await getCommunityBySlug(db, devPaidSeed.communitySlug);
    if (!community) {
      throw new Error("paid dev community missing");
    }
    expect(community).toMatchObject({
      name: "Cohory Pro",
      privacy: "private",
      joinMode: "approval",
      currency: null,
    });
    const [owner] = await db.select().from(users).where(eq(users.email, devSeed.email));
    const [member] = await db.select().from(users).where(eq(users.email, devMember.email));
    const members = await listMembershipsForCommunity(withCommunity(db, community.id));
    expect(members).toHaveLength(2);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner?.id, role: "owner", status: "active" }),
        expect.objectContaining({ userId: member?.id, role: "member", status: "active" }),
      ]),
    );
    const invites = await db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.token, devPaidSeed.inviteToken));
    expect(invites).toMatchObject([{ communityId: community.id, requiresApproval: false }]);
    expect(devPaidSeed.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const connections = await db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.communityId, community.id));
    const plans = await db
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.communityId, community.id));
    expect(connections).toEqual([]);
    expect(plans).toEqual([]);
  });

  it("adds the Cohory Creators community next to an older seeded community without changing it", async () => {
    const suffix = newId().slice(-8);
    const older: DevSeedConfig = {
      ...devSeed,
      communitySlug: uniqueSlug("older"),
      communityName: "Older Community",
      inviteToken: `older-invite-${suffix}`,
      people: [],
    };
    await seedDevDataWith(db, older);
    const before = await getCommunityBySlug(db, older.communitySlug);

    await seedDevData(db);

    const after = await getCommunityBySlug(db, older.communitySlug);
    expect(after).toEqual(before);
    expect(await getCommunityBySlug(db, devSeed.communitySlug)).not.toBeNull();
  });
});

describe("seedDevDataWith under concurrent callers", () => {
  it("creates each user, community, membership, and invite exactly once when seeders race", async () => {
    const suffix = newId().slice(-8);
    const seed: DevSeedConfig = {
      email: `owner-${suffix}@cohory.local`,
      password: devSeed.password,
      name: "Race Owner",
      username: `race-owner-${suffix}`,
      communitySlug: uniqueSlug("race"),
      communityName: "Race Community",
      communityDescription: "A community created by racing seeders.",
      privacy: "public",
      joinMode: "open",
      inviteToken: `race-invite-${suffix}`,
      people: [
        {
          email: `admin-${suffix}@cohory.local`,
          name: "Race Admin",
          username: `admin-${suffix}`,
          role: "admin",
        },
        {
          email: `member-${suffix}@cohory.local`,
          name: "Race Member",
          username: `member-${suffix}`,
          role: "member",
        },
        {
          email: `user-${suffix}@cohory.local`,
          name: "Race User",
          username: `user-${suffix}`,
          role: "none",
        },
      ],
    };

    const results = await Promise.all([
      seedDevDataWith(db, seed),
      seedDevDataWith(db, seed),
      seedDevDataWith(db, seed),
      seedDevDataWith(db, seed),
    ]);

    expect(results.filter((r) => r.userCreated)).toHaveLength(1);
    expect(results.filter((r) => r.communityCreated)).toHaveLength(1);
    expect(results.filter((r) => r.membershipCreated)).toHaveLength(1);
    expect(results.reduce((sum, r) => sum + r.usersCreated, 0)).toBe(seed.people.length);
    expect(results.reduce((sum, r) => sum + r.membersCreated, 0)).toBe(2);
    expect(results.filter((r) => r.inviteCreated)).toHaveLength(1);

    const owners = await db.select().from(users).where(eq(users.email, seed.email));
    expect(owners).toHaveLength(1);
    const community = await getCommunityBySlug(db, seed.communitySlug);
    if (!community) {
      throw new Error("race community missing");
    }
    const members = await listMembershipsForCommunity(withCommunity(db, community.id));
    expect(members).toHaveLength(3);
  });
});
