import { ForbiddenError } from "@cohory/authz";
import type { MemberAccessMap } from "@cohory/payments";
import { memberships, users } from "@cohory/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityNotFoundError,
  CommunityValidationError,
  MembershipNotFoundError,
} from "../errors";
import {
  insertCast,
  insertMember,
  openManageHarness,
  unpaidExit,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";
import type { MemberAccessPort } from "./member-access";
import type { MemberRemovedByStaff } from "./paid-exit";

let h: ManageHarness;
let accessByCommunity: Map<string, MemberAccessMap>;
const ended: MemberRemovedByStaff[] = [];

const fakeAccess: MemberAccessPort = {
  async list(_actor, communityId, userIds) {
    const map = accessByCommunity.get(communityId) ?? new Map();
    if (userIds === null) {
      return map;
    }
    return new Map([...map].filter(([userId]) => userIds.includes(userId)));
  },
};

beforeAll(async () => {
  accessByCommunity = new Map();
  h = await openManageHarness({
    memberAccess: fakeAccess,
    paidExit: {
      ...unpaidExit,
      async endMemberBilling(event) {
        ended.push(event);
      },
    },
  });
});

afterAll(async () => {
  await h.close();
});

async function statuses(cast: Cast, userIds: string[]): Promise<Record<string, string>> {
  const rows = await h.admin
    .select({ userId: memberships.userId, status: memberships.status })
    .from(memberships)
    .where(
      and(eq(memberships.communityId, cast.communityId), inArray(memberships.userId, userIds)),
    );
  return Object.fromEntries(rows.map((row) => [row.userId, row.status]));
}

describe("member access in the people list", () => {
  let cast: Cast;
  let payer: string;
  let comped: string;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
    payer = (await insertMember(h.admin, cast.communityId, "member", "active", "Payer")).userId;
    comped = (await insertMember(h.admin, cast.communityId, "member", "active", "Comped")).userId;
    accessByCommunity.set(
      cast.communityId,
      new Map([
        [payer, { access: "paying_monthly", until: new Date("2026-11-30T00:00:00Z") }],
        [comped, { access: "free_access", until: null }],
      ]),
    );
  });

  it("shows owners and admins each member's access", async () => {
    for (const viewer of [cast.owner, cast.admin]) {
      const page = await h.service.listMembersForManage(viewer, cast.communityId);
      const byId = new Map(page.data.map((m) => [m.userId, m.access]));

      expect(byId.get(payer)).toEqual({
        kind: "paying_monthly",
        until: new Date("2026-11-30T00:00:00Z"),
      });
      expect(byId.get(comped)).toEqual({ kind: "free_access", until: null });
      expect(byId.get(cast.member.userId)).toEqual({ kind: "none", until: null });
    }
  });

  it("hides access from moderators, who cannot see payments", async () => {
    const page = await h.service.listMembersForManage(cast.moderator, cast.communityId);

    expect(page.data.every((m) => m.access === null)).toBe(true);
  });

  it("filters by access", async () => {
    const paying = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      access: "paying_monthly",
    });
    const none = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      access: "none",
    });

    expect(paying.data.map((m) => m.userId)).toEqual([payer]);
    expect(none.data.map((m) => m.userId)).not.toContain(payer);
    expect(none.data.map((m) => m.userId)).not.toContain(comped);
    expect(none.data).toHaveLength(4);
  });

  it("filters for anyone with a paid subscription, leaving out free access", async () => {
    const paying = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      access: "paying",
    });

    expect(paying.data.map((m) => m.userId)).toEqual([payer]);
  });
});

describe("members who have not signed in yet", () => {
  it("marks imported members without a sign in and filters for them", async () => {
    const cast = await insertCast(h.admin);
    const imported = await insertMember(h.admin, cast.communityId, "member", "active", "Imported");
    await h.admin
      .update(users)
      .set({ emailVerified: true })
      .where(inArray(users.id, [cast.owner.userId, cast.admin.userId]));
    await h.admin.execute(
      sql`insert into sessions (id, user_id, token, expires_at) values (gen_random_uuid(), ${cast.moderator.userId}, gen_random_uuid()::text, now() + interval '1 day')`,
    );
    await h.admin.execute(
      sql`insert into accounts (id, user_id, account_id, provider_id) values (gen_random_uuid(), ${cast.member.userId}, ${cast.member.userId}, 'credential')`,
    );

    const all = await h.service.listMembersForManage(cast.owner, cast.communityId);
    const never = await h.service.listMembersForManage(cast.owner, cast.communityId, {
      neverSignedIn: true,
    });

    expect(all.data.find((m) => m.userId === imported.userId)?.signedIn).toBe(false);
    expect(all.data.filter((m) => m.signedIn)).toHaveLength(4);
    expect(never.data.map((m) => m.userId)).toEqual([imported.userId]);
  });
});

describe("getMemberForManage", () => {
  it("shows staff one person with their join answers and access", async () => {
    const cast = await insertCast(h.admin);
    await h.service.updateSettings(cast.owner, cast.communityId, {
      joinMode: "approval",
      joinQuestions: [{ text: "Why join?", required: true }],
    });
    const person = await insertMember(h.admin, cast.communityId, "member", "removed", "Asker");
    await h.service.requestToJoin(person, cast.communityId, { answers: ["To learn"] });
    accessByCommunity.set(
      cast.communityId,
      new Map([[person.userId, { access: "past_due", until: null }]]),
    );

    const detail = await h.service.getMemberForManage(cast.owner, cast.communityId, person.userId);
    const asModerator = await h.service.getMemberForManage(
      cast.moderator,
      cast.communityId,
      person.userId,
    );

    expect(detail.member).toMatchObject({ name: "Asker", access: { kind: "past_due" } });
    expect(detail.answers).toEqual([{ question: "Why join?", answer: "To learn" }]);
    expect(detail.requestedAt).toBeInstanceOf(Date);
    expect(asModerator.member.access).toBeNull();
    expect(asModerator.member.email).toBeNull();
  });

  it("shows the answers a paid member gave before checkout", async () => {
    const cast = await insertCast(h.admin);
    const answers = [{ question: "What brings you here?", answer: "Pottery" }];
    await h.admin
      .update(memberships)
      .set({ joinAnswers: answers })
      .where(
        and(
          eq(memberships.communityId, cast.communityId),
          eq(memberships.userId, cast.member.userId),
        ),
      );

    const detail = await h.service.getMemberForManage(
      cast.owner,
      cast.communityId,
      cast.member.userId,
    );

    expect(detail.answers).toEqual(answers);
    expect(detail.requestedAt).toBeNull();
  });

  it("refuses regular members", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.getMemberForManage(cast.member, cast.communityId, cast.admin.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not show a person from another community", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);

    await expect(
      h.service.getMemberForManage(cast.owner, cast.communityId, other.member.userId),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    await expect(
      h.service.getMemberForManage(other.owner, cast.communityId, cast.member.userId),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("answers not found for an id that is not a uuid", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.getMemberForManage(cast.owner, cast.communityId, "nope"),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe("applyMemberAction", () => {
  it("removes several members through the single removal path and ends their billing", async () => {
    const cast = await insertCast(h.admin);
    const second = await insertMember(h.admin, cast.communityId);
    ended.length = 0;

    const result = await h.service.applyMemberAction(cast.owner, cast.communityId, {
      userIds: [cast.member.userId, second.userId],
      action: "remove",
    });

    expect(result).toEqual({ done: [cast.member.userId, second.userId], failed: [] });
    expect(await statuses(cast, [cast.member.userId, second.userId])).toEqual({
      [cast.member.userId]: "removed",
      [second.userId]: "removed",
    });
    expect(ended.map((e) => [e.userId, e.kind])).toEqual([
      [cast.member.userId, "removed"],
      [second.userId, "removed"],
    ]);
  });

  it("bans several members as an admin", async () => {
    const cast = await insertCast(h.admin);
    const second = await insertMember(h.admin, cast.communityId);

    const result = await h.service.applyMemberAction(cast.admin, cast.communityId, {
      userIds: [cast.member.userId, second.userId, cast.moderator.userId],
      action: "ban",
    });

    expect(result.failed).toEqual([]);
    expect(Object.values(await statuses(cast, result.done.slice()))).toEqual([
      "banned",
      "banned",
      "banned",
    ]);
  });

  it("lets a moderator remove members but reports the admin it may not remove", async () => {
    const cast = await insertCast(h.admin);
    ended.length = 0;

    const result = await h.service.applyMemberAction(cast.moderator, cast.communityId, {
      userIds: [cast.member.userId, cast.admin.userId],
      action: "remove",
    });

    expect(result).toEqual({
      done: [cast.member.userId],
      failed: [{ id: cast.admin.userId, code: "forbidden" }],
    });
    expect(await statuses(cast, [cast.admin.userId])).toEqual({ [cast.admin.userId]: "active" });
    expect(ended.map((e) => e.userId)).toEqual([cast.member.userId]);
  });

  it("refuses regular members outright", async () => {
    const cast = await insertCast(h.admin);
    const second = await insertMember(h.admin, cast.communityId);

    await expect(
      h.service.applyMemberAction(cast.member, cast.communityId, {
        userIds: [second.userId],
        action: "remove",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statuses(cast, [second.userId])).toEqual({ [second.userId]: "active" });
  });

  it("does not touch another community's members", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);

    const result = await h.service.applyMemberAction(cast.owner, cast.communityId, {
      userIds: [other.member.userId],
      action: "ban",
    });

    expect(result).toEqual({ done: [], failed: [{ id: other.member.userId, code: "not_found" }] });
    expect(await statuses(other, [other.member.userId])).toEqual({
      [other.member.userId]: "active",
    });
    await expect(
      h.service.applyMemberAction(other.owner, cast.communityId, {
        userIds: [cast.member.userId],
        action: "ban",
      }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("rejects an empty or oversized selection", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.applyMemberAction(cast.owner, cast.communityId, { userIds: [], action: "ban" }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });
});
