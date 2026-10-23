import { addMembership, parseCommunityId, withCommunity } from "@cohory/db";
import {
  auditLog,
  inviteLinks,
  users,
  type MemberRole,
  type MemberStatus,
} from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  insertCommunity,
  insertMember,
  openManageHarness,
  type ManageHarness,
  type UserActor,
} from "../test/manage-fixtures";
import { createPostgresManageRepository } from "../manage/postgres-repository";
import { createPostgresCreatorsInviteStore } from "./postgres-store";
import {
  createCreatorsInviteService,
  creatorsInviteToken,
  type CreatorsInviteMessage,
} from "./service";

const secret = "integration-secret-long-enough-for-the-hmac-0";

let harness: ManageHarness;
let creators: { id: string; slug: string };
let creatorsOwner: UserActor;

beforeAll(async () => {
  harness = await openManageHarness();
  const community = await insertCommunity(harness.admin, "private");
  creators = { id: community.id, slug: community.slug };
  creatorsOwner = await insertMember(harness.admin, community.id, "owner", "active", "Riza");
});

afterAll(async () => {
  await harness.close();
});

async function createdBy(name: string, verified = true) {
  const community = await insertCommunity(harness.admin, "public");
  const owner = await insertMember(harness.admin, community.id, "owner", "active", name);
  await harness.admin
    .update(users)
    .set({ emailVerified: verified })
    .where(eq(users.id, owner.userId));
  return { communityId: community.id, owner };
}

function serviceWith(sent: CreatorsInviteMessage[], optedOut = false) {
  return createCreatorsInviteService({
    store: createPostgresCreatorsInviteStore(
      harness.app,
      createPostgresManageRepository(harness.app),
    ),
    creatorsSlug: creators.slug,
    secret,
    appUrl: "https://cohory.test",
    isOptedOut: async () => optedOut,
    send: async (message) => {
      sent.push(message);
    },
  });
}

describe("creators invite on Postgres", () => {
  it("stores a single use invite from the owner that joins the creator without approval", async () => {
    const sent: CreatorsInviteMessage[] = [];
    const { communityId, owner } = await createdBy("Ada");

    expect(await serviceWith(sent).inviteCreator({ communityId, trigger: "post" })).toBe("sent");

    const token = creatorsInviteToken(secret, owner.userId);
    const [row] = await harness.admin
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.token, token));
    expect(row).toMatchObject({
      communityId: creators.id,
      createdBy: creatorsOwner.userId,
      maxUses: 1,
      requiresApproval: false,
      useCount: 0,
    });
    expect(sent.map((message) => message.url)).toEqual([`https://cohory.test/join/${token}`]);
    expect(sent[0]?.inviterName).toBe("Riza");
    const audit = await harness.admin
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.communityId, creators.id), eq(auditLog.target, row?.id ?? "")));
    expect(audit).toEqual([
      expect.objectContaining({
        action: "invite.created",
        metadata: expect.objectContaining({ automatic: "creators_invite" }),
      }),
    ]);

    const joined = await harness.service.redeemInvite(owner, token);
    expect(joined.membership?.status).toBe("active");
    expect(joined.request).toBeNull();
  });

  it("invites each person once, even for a second community they create", async () => {
    const sent: CreatorsInviteMessage[] = [];
    const first = await createdBy("Grace");
    const service = serviceWith(sent);
    expect(await service.inviteCreator({ communityId: first.communityId, trigger: "post" })).toBe(
      "sent",
    );
    const second = await insertCommunity(harness.admin, "public");
    await join(second.id, first.owner.userId, "owner", "active");
    expect(await service.inviteCreator({ communityId: second.id, trigger: "course" })).toBe(
      "already_invited",
    );
    expect(sent).toHaveLength(1);
  });

  it("skips a banned creator and an unconfirmed one without storing an invite", async () => {
    const sent: CreatorsInviteMessage[] = [];
    const banned = await createdBy("Linus");
    await join(creators.id, banned.owner.userId, "member", "banned");
    const unconfirmed = await createdBy("Ken", false);
    const service = serviceWith(sent);

    expect(await service.inviteCreator({ communityId: banned.communityId, trigger: "post" })).toBe(
      "banned",
    );
    expect(
      await service.inviteCreator({ communityId: unconfirmed.communityId, trigger: "post" }),
    ).toBe("unconfirmed");
    for (const userId of [banned.owner.userId, unconfirmed.owner.userId]) {
      const rows = await harness.admin
        .select({ id: inviteLinks.id })
        .from(inviteLinks)
        .where(eq(inviteLinks.token, creatorsInviteToken(secret, userId)));
      expect(rows).toEqual([]);
    }
    expect(sent).toEqual([]);
  });
});

async function join(
  communityId: string,
  userId: string,
  role: MemberRole,
  status: MemberStatus,
): Promise<void> {
  await addMembership(withCommunity(harness.admin, parseCommunityId(communityId)), {
    userId,
    role,
    status,
    joinedAt: new Date(),
  });
}
