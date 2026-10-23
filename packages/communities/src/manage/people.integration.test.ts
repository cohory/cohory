import { ForbiddenError } from "@cohory/authz";
import { memberships, reviews, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipNotFoundError } from "../errors";
import { createPostgresCommunitiesRepository } from "../postgres-repository";
import { createCommunitiesService } from "../service";
import {
  auditActions,
  insertCast,
  insertMember,
  insertUser,
  openManageHarness,
  unpaidExit,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";
import type { MemberRemovedByStaff } from "./paid-exit";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

async function membership(cast: Cast, userId: string) {
  const [row] = await h.admin
    .select()
    .from(memberships)
    .where(and(eq(memberships.communityId, cast.communityId), eq(memberships.userId, userId)));
  return row;
}

describe("listMembersForManage", () => {
  let cast: Cast;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
    await insertMember(h.admin, cast.communityId, "member", "banned", "Banned Person");
  });

  it("shows emails to admins and pages with a cursor", async () => {
    const first = await h.service.listMembersForManage(cast.admin, cast.communityId, { limit: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.data.every((m) => m.email?.endsWith("@example.test"))).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await h.service.listMembersForManage(cast.admin, cast.communityId, {
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.data, ...second.data].map((m) => m.userId).sort();
    expect(ids).toEqual(
      [cast.owner, cast.admin, cast.moderator, cast.member].map((a) => a.userId).sort(),
    );
  });

  it("hides emails from moderators", async () => {
    const page = await h.service.listMembersForManage(cast.moderator, cast.communityId);
    expect(page.data.every((m) => m.email === null)).toBe(true);
  });

  it("filters by status, role, and name prefix", async () => {
    const banned = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      status: "banned",
    });
    expect(banned.data.map((m) => m.name)).toEqual(["Banned Person"]);

    const admins = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      role: "admin",
    });
    expect(admins.data.map((m) => m.userId)).toEqual([cast.admin.userId]);

    const named = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      query: "mod",
    });
    expect(named.data.map((m) => m.userId)).toEqual([cast.moderator.userId]);
  });

  it("refuses a member", async () => {
    await expect(
      h.service.listMembersForManage(cast.member, cast.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("changeRole", () => {
  it("lets the owner promote to admin and audits the change", async () => {
    const cast = await insertCast(h.admin);

    const change = await h.service.changeRole(
      cast.owner,
      cast.communityId,
      cast.member.userId,
      "admin",
    );

    expect(change.role).toBe("admin");
    expect((await membership(cast, cast.member.userId))?.role).toBe("admin");
    expect(await auditActions(h.admin, cast.communityId)).toContain("member.role_changed");
  });

  it("lets an admin set moderator and member but not admin", async () => {
    const cast = await insertCast(h.admin);

    await h.service.changeRole(cast.admin, cast.communityId, cast.member.userId, "moderator");
    await h.service.changeRole(cast.admin, cast.communityId, cast.moderator.userId, "member");
    await expect(
      h.service.changeRole(cast.admin, cast.communityId, cast.member.userId, "admin"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.changeRole(cast.admin, cast.communityId, cast.admin.userId, "member"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never changes the owner and refuses moderators and members", async () => {
    const cast = await insertCast(h.admin);

    for (const actor of [cast.owner, cast.admin, cast.moderator, cast.member]) {
      await expect(
        h.service.changeRole(actor, cast.communityId, cast.owner.userId, "member"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      h.service.changeRole(cast.moderator, cast.communityId, cast.member.userId, "moderator"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await membership(cast, cast.owner.userId))?.role).toBe("owner");
  });

  it("answers not found for someone outside the community", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.changeRole(cast.owner, cast.communityId, cast.outsider.userId, "member"),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe("removeMember", () => {
  it("marks a member removed and refuses to remove the owner", async () => {
    const cast = await insertCast(h.admin);

    await h.service.removeMember(cast.moderator, cast.communityId, cast.member.userId);
    expect(await membership(cast, cast.member.userId)).toMatchObject({
      status: "removed",
      removalReason: "removed",
    });

    await expect(
      h.service.removeMember(cast.owner, cast.communityId, cast.owner.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.removeMember(cast.admin, cast.communityId, cast.owner.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.removeMember(cast.moderator, cast.communityId, cast.admin.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides the removed member's review, which leaving would keep", async () => {
    const cast = await insertCast(h.admin);
    await h.admin.insert(reviews).values({
      communityId: cast.communityId,
      authorId: cast.member.userId,
      rating: 1,
      body: "A review written before the removal.",
    });

    await h.service.removeMember(cast.moderator, cast.communityId, cast.member.userId);

    const [row] = await h.admin
      .select({ removedAt: reviews.authorRemovedAt })
      .from(reviews)
      .where(eq(reviews.authorId, cast.member.userId));
    expect(row?.removedAt).not.toBeNull();
  });

  it("demotes a removed admin so rejoining does not restore the role", async () => {
    const cast = await insertCast(h.admin);

    await h.service.removeMember(cast.owner, cast.communityId, cast.admin.userId);

    expect(await membership(cast, cast.admin.userId)).toMatchObject({
      status: "removed",
      role: "member",
    });
  });
});

describe("banMember", () => {
  it("blocks rejoining with the same account and with the same email on a new account", async () => {
    const cast = await insertCast(h.admin, "public");
    const communities = createCommunitiesService(createPostgresCommunitiesRepository(h.app));
    const [banned] = await h.admin
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, cast.member.userId));

    await h.service.banMember(cast.moderator, cast.communityId, cast.member.userId);

    expect(await membership(cast, cast.member.userId)).toMatchObject({
      status: "banned",
      bannedEmail: banned?.email,
    });
    await expect(communities.joinCommunity(cast.member, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await h.admin
      .update(users)
      .set({ email: `renamed-${cast.member.userId}@example.test` })
      .where(eq(users.id, cast.member.userId));
    const newAccount = await insertUser(h.admin, "New Account", banned?.email.toUpperCase());
    await expect(communities.joinCommunity(newAccount, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await auditActions(h.admin, cast.communityId)).toContain("member.banned");
  });

  it("unbans so the person can join again", async () => {
    const cast = await insertCast(h.admin, "public");
    const communities = createCommunitiesService(createPostgresCommunitiesRepository(h.app));
    await h.service.banMember(cast.admin, cast.communityId, cast.member.userId);

    await expect(
      h.service.unbanMember(cast.member, cast.communityId, cast.member.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await h.service.unbanMember(cast.admin, cast.communityId, cast.member.userId);

    expect(await membership(cast, cast.member.userId)).toMatchObject({
      status: "removed",
      bannedEmail: null,
      removalReason: null,
    });
    expect((await communities.joinCommunity(cast.member, cast.communityId)).status).toBe("active");
  });

  it("refuses to ban the owner or a member of another community", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await expect(
      h.service.banMember(cast.admin, cast.communityId, cast.owner.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.banMember(cast.owner, cast.communityId, other.member.userId),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe("ending a removed member's billing", () => {
  let paid: ManageHarness;
  const delivered: (MemberRemovedByStaff & { readonly statusWhenCalled: string | undefined })[] =
    [];

  beforeAll(async () => {
    paid = await openManageHarness({
      paidExit: {
        ...unpaidExit,
        async endMemberBilling(event) {
          const [row] = await paid.admin
            .select({ status: memberships.status })
            .from(memberships)
            .where(
              and(
                eq(memberships.communityId, event.communityId),
                eq(memberships.userId, event.userId),
              ),
            );
          delivered.push({ ...event, statusWhenCalled: row?.status });
        },
      },
    });
  });

  afterAll(async () => {
    await paid.close();
  });

  it("asks Payments to end billing once the removal is saved", async () => {
    const cast = await insertCast(paid.admin);
    delivered.length = 0;

    await paid.service.removeMember(cast.moderator, cast.communityId, cast.member.userId);

    expect(delivered).toEqual([
      {
        communityId: cast.communityId,
        userId: cast.member.userId,
        kind: "removed",
        statusWhenCalled: "removed",
      },
    ]);
  });

  it("asks Payments to end billing once the ban is saved, and again on a repeated ban", async () => {
    const cast = await insertCast(paid.admin);
    delivered.length = 0;

    await paid.service.banMember(cast.admin, cast.communityId, cast.member.userId);
    await paid.service.banMember(cast.admin, cast.communityId, cast.member.userId);

    const expected = {
      communityId: cast.communityId,
      userId: cast.member.userId,
      kind: "banned",
      statusWhenCalled: "banned",
    };
    expect(delivered).toEqual([expected, expected]);
    expect(
      (await auditActions(paid.admin, cast.communityId)).filter((a) => a === "member.banned"),
    ).toHaveLength(1);
  });

  it("does not touch billing when the removal is refused", async () => {
    const cast = await insertCast(paid.admin);
    delivered.length = 0;

    await expect(
      paid.service.removeMember(cast.moderator, cast.communityId, cast.admin.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      paid.service.banMember(cast.member, cast.communityId, cast.moderator.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(delivered).toEqual([]);
  });

  it("does not touch billing when a member leaves on their own", async () => {
    const cast = await insertCast(paid.admin);
    const communities = createCommunitiesService(createPostgresCommunitiesRepository(paid.app));
    delivered.length = 0;

    await communities.leaveCommunity(cast.member, cast.communityId);

    expect(delivered).toEqual([]);
    expect(await membership(cast, cast.member.userId)).toMatchObject({ removalReason: "left" });
  });
});
