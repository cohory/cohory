import { ForbiddenError } from "@cohory/authz";
import { communities, inviteLinks, membershipHolds, memberships, users } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityArchivedError,
  CommunityNotFoundError,
  CommunityValidationError,
  InviteNotFoundError,
  InviteUnavailableError,
  PaymentRequiredError,
} from "../errors";
import {
  insertCast,
  insertUser,
  openManageHarness,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

async function useCount(inviteId: string): Promise<number | undefined> {
  const [row] = await h.admin
    .select({ useCount: inviteLinks.useCount })
    .from(inviteLinks)
    .where(eq(inviteLinks.id, inviteId));
  return row?.useCount;
}

describe("invite links", () => {
  it("lets an admin create, list, and revoke links with a /join/{token} path", async () => {
    const cast = await insertCast(h.admin);
    const expiresAt = new Date(Date.now() + 86_400_000);

    const invite = await h.service.createInviteLink(cast.admin, cast.communityId, {
      expiresAt,
      maxUses: 5,
    });

    expect(invite).toMatchObject({ maxUses: 5, useCount: 0, status: "active" });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.path).toBe(`/join/${invite.token}`);
    expect(
      (await h.service.listInviteLinks(cast.owner, cast.communityId)).map((i) => i.id),
    ).toEqual([invite.id]);
    const revoked = await h.service.revokeInviteLink(cast.admin, cast.communityId, invite.id);
    expect(revoked.status).toBe("revoked");
  });

  it("keeps an optional label and still lists the link with its use count once revoked", async () => {
    const cast = await insertCast(h.admin);

    const labeled = await h.service.createInviteLink(cast.owner, cast.communityId, {
      label: "  Instagram bio  ",
    });
    const blank = await h.service.createInviteLink(cast.owner, cast.communityId, { label: " " });
    await h.service.revokeInviteLink(cast.owner, cast.communityId, labeled.id);

    expect(labeled.label).toBe("Instagram bio");
    expect(blank.label).toBeNull();
    const listed = await h.service.listInviteLinks(cast.owner, cast.communityId);
    expect(listed.find((i) => i.id === labeled.id)).toMatchObject({
      label: "Instagram bio",
      status: "revoked",
      useCount: 0,
    });
  });

  it("rejects a label longer than 60 characters", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.createInviteLink(cast.owner, cast.communityId, { label: "x".repeat(61) }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it.each(["moderator", "member", "outsider"] as const)("refuses a %s", async (role) => {
    const cast = await insertCast(h.admin, "public");
    await expect(h.service.createInviteLink(cast[role], cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(h.service.listInviteLinks(cast[role], cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("does not let one community's owner revoke another community's link", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(other.owner, other.communityId);

    await expect(
      h.service.revokeInviteLink(cast.owner, cast.communityId, invite.id),
    ).rejects.toBeInstanceOf(InviteNotFoundError);
    await expect(
      h.service.revokeInviteLink(cast.owner, other.communityId, invite.id),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    const [row] = await h.service.listInviteLinks(other.owner, other.communityId);
    expect(row?.status).toBe("active");
  });

  it("does not list another community's links", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await h.service.createInviteLink(other.owner, other.communityId);

    expect(await h.service.listInviteLinks(cast.owner, cast.communityId)).toEqual([]);
  });
});

describe("previewInvite", () => {
  it("shows anyone the community name and whether the link still works", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId, { maxUses: 1 });

    expect(await h.service.previewInvite(invite.token)).toEqual({
      community: { slug: cast.slug, name: expect.any(String) },
      status: "active",
    });

    await h.service.redeemInvite(cast.outsider, invite.token);
    expect((await h.service.previewInvite(invite.token))?.status).toBe("used_up");

    const revoked = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.revokeInviteLink(cast.owner, cast.communityId, revoked.id);
    expect((await h.service.previewInvite(revoked.token))?.status).toBe("revoked");

    const archived = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.archiveCommunity(cast.owner, cast.communityId);
    expect((await h.service.previewInvite(archived.token))?.status).toBe("archived");
  });

  it("answers null for an unknown or malformed token", async () => {
    expect(await h.service.previewInvite("not a token")).toBeNull();
    expect(await h.service.previewInvite("A".repeat(43))).toBeNull();
  });
});

describe("redeemInvite", () => {
  it("asks for payment and records the invite as a pending membership in a paid community", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.admin
      .update(communities)
      .set({ currency: "usd", joinMode: "invite" })
      .where(eq(communities.id, cast.communityId));

    await expect(h.service.redeemInvite(cast.outsider, invite.token)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
    await expect(h.service.redeemInvite(cast.outsider, invite.token)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );

    const [membership] = await h.admin
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.communityId, cast.communityId),
          eq(memberships.userId, cast.outsider.userId),
        ),
      );
    expect(membership).toMatchObject({ status: "pending", joinedAt: null });
    expect(await useCount(invite.id)).toBe(1);
  });

  it("holds the pending membership of a paid invite for 24 hours", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.admin
      .update(communities)
      .set({ currency: "usd", joinMode: "invite" })
      .where(eq(communities.id, cast.communityId));
    const before = Date.now();

    await expect(h.service.redeemInvite(cast.outsider, invite.token)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );

    const [hold] = await h.admin
      .select()
      .from(membershipHolds)
      .where(
        and(
          eq(membershipHolds.communityId, cast.communityId),
          eq(membershipHolds.userId, cast.outsider.userId),
        ),
      );
    expect(hold?.inviteId).toBe(invite.id);
    const lasts = (hold?.expiresAt.getTime() ?? 0) - before;
    expect(lasts).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(lasts).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 60_000);
  });

  it("locks the hold before the membership when an invite is redeemed again, so a late Checkout cannot deadlock it", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.admin
      .update(communities)
      .set({ currency: "usd", joinMode: "invite" })
      .where(eq(communities.id, cast.communityId));
    const userId = cast.outsider.userId;
    await h.admin
      .insert(memberships)
      .values({ communityId: cast.communityId, userId, status: "removed" });
    await h.admin.insert(membershipHolds).values({
      communityId: cast.communityId,
      userId,
      inviteId: invite.id,
      expiresAt: new Date(Date.now() - 1000),
      releasedAt: new Date(),
    });
    const scoped = (table: typeof membershipHolds | typeof memberships) =>
      and(eq(table.communityId, cast.communityId), eq(table.userId, userId));

    let redeem: Promise<unknown> = Promise.resolve();
    await h.admin.transaction(async (tx) => {
      await tx.select().from(membershipHolds).where(scoped(membershipHolds)).for("update");
      redeem = h.service.redeemInvite(cast.outsider, invite.token).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.select().from(memberships).where(scoped(memberships)).for("update");
    });

    expect(await redeem).toBeInstanceOf(PaymentRequiredError);
  });

  it("does not record a pending membership for a banned email in a paid community", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.banMember(cast.owner, cast.communityId, cast.member.userId);
    await h.admin
      .update(communities)
      .set({ currency: "usd" })
      .where(eq(communities.id, cast.communityId));

    await expect(h.service.redeemInvite(cast.member, invite.token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await useCount(invite.id)).toBe(0);
  });

  it("joins a private community and counts the use once per person", async () => {
    const cast = await insertCast(h.admin, "private");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);

    const result = await h.service.redeemInvite(cast.outsider, invite.token);
    const again = await h.service.redeemInvite(cast.outsider, invite.token);

    expect(result.community.id).toBe(cast.communityId);
    expect(result.membership).toMatchObject({ role: "member", status: "active" });
    expect(again.membership?.id).toBe(result.membership?.id);
    expect(await useCount(invite.id)).toBe(1);
  });

  it("refuses expired, revoked, used up, and unknown links", async () => {
    let now = new Date("2026-10-18T10:00:00Z");
    const timed = await openManageHarness({ now: () => now });
    try {
      const cast = await insertCast(timed.admin);
      const expiring = await timed.service.createInviteLink(cast.owner, cast.communityId, {
        expiresAt: new Date("2026-10-18T11:00:00Z"),
      });
      const revoked = await timed.service.createInviteLink(cast.owner, cast.communityId);
      await timed.service.revokeInviteLink(cast.owner, cast.communityId, revoked.id);
      const single = await timed.service.createInviteLink(cast.owner, cast.communityId, {
        maxUses: 1,
      });
      await timed.service.redeemInvite(await insertUser(timed.admin), single.token);
      now = new Date("2026-10-18T12:00:00Z");

      for (const token of [expiring.token, revoked.token, single.token, "x".repeat(43), "short"]) {
        await expect(
          timed.service.redeemInvite(await insertUser(timed.admin), token),
        ).rejects.toBeInstanceOf(InviteUnavailableError);
      }
    } finally {
      await timed.close();
    }
  });

  it("rejects an expiry in the past", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.createInviteLink(cast.owner, cast.communityId, { expiresAt: new Date(0) }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("refuses a banned person and a banned email", async () => {
    const cast = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.banMember(cast.owner, cast.communityId, cast.member.userId);

    await expect(h.service.redeemInvite(cast.member, invite.token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const [banned] = await h.admin
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, cast.member.userId));
    await h.admin
      .update(users)
      .set({ email: `moved-${cast.member.userId}@example.test` })
      .where(eq(users.id, cast.member.userId));
    const sameEmail = await insertUser(h.admin, "Same Email", banned?.email);
    await expect(h.service.redeemInvite(sameEmail, invite.token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await useCount(invite.id)).toBe(0);
  });

  it("refuses an archived community", async () => {
    const cast = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.archiveCommunity(cast.owner, cast.communityId);

    await expect(h.service.redeemInvite(cast.outsider, invite.token)).rejects.toBeInstanceOf(
      CommunityArchivedError,
    );
  });

  it("never exceeds max uses under concurrent redemption", async () => {
    const cast = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId, { maxUses: 3 });
    const people = await Promise.all(Array.from({ length: 8 }, () => insertUser(h.admin)));

    const results = await Promise.allSettled(
      people.map((person) => h.service.redeemInvite(person, invite.token)),
    );

    const joined = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InviteUnavailableError,
    );
    expect(joined).toHaveLength(3);
    expect(refused).toHaveLength(5);
    expect(await useCount(invite.id)).toBe(3);
    const active = await h.admin
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.communityId, cast.communityId), eq(memberships.status, "active")));
    expect(active).toHaveLength(4 + 3);
  });
});
