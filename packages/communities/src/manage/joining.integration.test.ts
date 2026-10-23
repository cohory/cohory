import { ForbiddenError } from "@cohory/authz";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { communities, memberships, membershipRequests, outbox } from "@cohory/db/schema";
import type { JoinMode, JoinQuestion } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createRateLimiter, rateLimitDefaults, RateLimitedError } from "@cohory/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRlsValue } from "@cohory/db";

import {
  CommunityNotFoundError,
  CommunityValidationError,
  InviteOnlyError,
  JoinRequestNotFoundError,
  PaymentRequiredError,
} from "../errors";
import { membershipEventsTopic } from "./events";
import {
  auditActions,
  insertCast,
  insertMember,
  insertUser,
  manageProbeRole,
  openManageHarness,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;
let limited: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
  limited = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_MEMBERS: "5", FAIR_USE_STORAGE_BYTES: "1000" }),
  });
});

afterAll(async () => {
  await h.close();
  await limited.close();
});

const questions: JoinQuestion[] = [
  { text: "What do you want to learn?", required: true },
  { text: "Where did you hear about us?", required: false },
];

async function approvalCast(
  harness: ManageHarness = h,
  joinMode: JoinMode = "approval",
  privacy: "public" | "private" = "private",
): Promise<Cast> {
  const cast = await insertCast(harness.admin, privacy);
  await harness.service.updateSettings(cast.owner, cast.communityId, {
    joinMode,
    joinQuestions: questions,
  });
  return cast;
}

async function statusOf(cast: Cast, userId: string): Promise<string | undefined> {
  const [row] = await h.admin
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.communityId, cast.communityId), eq(memberships.userId, userId)));
  return row?.status;
}

describe("join settings", () => {
  it("stores the join mode and up to three questions for managers", async () => {
    const cast = await approvalCast();

    const settings = await h.service.getSettings(cast.admin, cast.communityId);

    expect(settings).toMatchObject({ joinMode: "approval", joinQuestions: questions });
  });

  it("refuses a fourth question", async () => {
    const cast = await insertCast(h.admin);
    const four = [1, 2, 3, 4].map((n) => ({ text: `Question ${n}`, required: false }));

    await expect(
      h.service.updateSettings(cast.owner, cast.communityId, { joinQuestions: four }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it.each(["moderator", "member"] as const)("refuses a %s", async (role) => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.updateSettings(cast[role], cast.communityId, { joinMode: "invite" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requestToJoin", () => {
  it("is rate limited in the service with the same user key as every other surface", async () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, joinRequest: { max: 1, windowSeconds: 600 } },
      disabled: false,
    });
    const keys: string[] = [];
    const throttled = await openManageHarness({
      rateLimit: (rule, key) => {
        keys.push(key);
        limiter.consume(rule, key);
      },
    });
    try {
      const first = await approvalCast(throttled);
      const second = await approvalCast(throttled);
      const person = first.outsider;

      await throttled.service.requestToJoin(person, first.communityId, { answers: ["Pottery"] });
      await expect(
        throttled.service.requestToJoin(person, second.communityId, { answers: ["Pottery"] }),
      ).rejects.toBeInstanceOf(RateLimitedError);
      expect(keys).toEqual([`user:${person.userId}`, `user:${person.userId}`]);
    } finally {
      await throttled.close();
    }
  });

  it.each(["private", "public"] as const)(
    "creates one pending request with answers in a %s community",
    async (privacy) => {
      const cast = await approvalCast(h, "approval", privacy);

      const request = await h.service.requestToJoin(cast.outsider, cast.communityId, {
        answers: ["  Pottery ", ""],
      });
      const again = await h.service.requestToJoin(cast.outsider, cast.communityId, {
        answers: ["Something else"],
      });

      expect(request).toMatchObject({ status: "pending", decisionNote: null });
      expect(again.id).toBe(request.id);
      expect(
        (await h.service.getJoinStatus(cast.outsider, cast.communityId)).request,
      ).toMatchObject({
        id: request.id,
        status: "pending",
      });
      expect(await statusOf(cast, cast.outsider.userId)).toBeUndefined();
      expect(await auditActions(h.admin, cast.communityId)).toContain("join_request.created");
    },
  );

  it("requires answers to required questions", async () => {
    const cast = await approvalCast();

    const error = await h.service
      .requestToJoin(cast.outsider, cast.communityId, { answers: ["", "Friends"] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommunityValidationError);
    expect(error).toMatchObject({ issues: [{ path: "answers.0" }] });
  });

  it("refuses a request in an open community and an invite only community", async () => {
    const open = await approvalCast(h, "open");
    const invite = await approvalCast(h, "invite");

    await expect(
      h.service.requestToJoin(open.outsider, open.communityId, { answers: ["x"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.requestToJoin(invite.outsider, invite.communityId, { answers: ["x"] }),
    ).rejects.toBeInstanceOf(InviteOnlyError);
  });

  it("refuses an active member, a banned person, and a paid community", async () => {
    const cast = await approvalCast();
    const banned = await insertUser(h.admin);
    await h.admin.insert(memberships).values({
      communityId: cast.communityId,
      userId: banned.userId,
      status: "banned",
    });

    await expect(
      h.service.requestToJoin(cast.member, cast.communityId, { answers: ["x"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.requestToJoin(banned, cast.communityId, { answers: ["x"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await h.admin
      .update(communities)
      .set({ currency: "usd" })
      .where(eq(communities.id, cast.communityId));
    await expect(
      h.service.requestToJoin(cast.outsider, cast.communityId, { answers: ["x"] }),
    ).rejects.toBeInstanceOf(PaymentRequiredError);
  });
});

describe("join request queue", () => {
  it.each(["moderator", "admin", "owner"] as const)(
    "shows pending requests with answers to a %s",
    async (role) => {
      const cast = await approvalCast();
      await h.service.requestToJoin(cast.outsider, cast.communityId, { answers: ["Pottery"] });

      const queue = await h.service.listJoinRequests(cast[role], cast.communityId);

      expect(queue.pendingCount).toBe(1);
      expect(queue.data).toHaveLength(1);
      expect(queue.data[0]).toMatchObject({
        userId: cast.outsider.userId,
        name: "Outsider",
        answers: [
          { question: questions[0]?.text, answer: "Pottery" },
          { question: questions[1]?.text, answer: "" },
        ],
      });
      expect(queue.data[0]?.email === null).toBe(role === "moderator");
    },
  );

  it.each(["member", "outsider"] as const)("refuses a %s", async (role) => {
    const cast = await approvalCast();

    await expect(h.service.listJoinRequests(cast[role], cast.communityId)).rejects.toBeInstanceOf(
      role === "outsider" ? CommunityNotFoundError : ForbiddenError,
    );
  });

  it("counts pending requests for staff only, scoped to the community", async () => {
    const mine = await approvalCast();
    const theirs = await approvalCast();
    await h.service.requestToJoin(mine.outsider, mine.communityId, { answers: ["Pottery"] });
    await h.service.requestToJoin(theirs.outsider, theirs.communityId, { answers: ["Clay"] });

    expect(await h.service.countJoinRequests(mine.moderator, mine.communityId)).toBe(1);
    expect(await h.service.countJoinRequests(mine.owner, mine.communityId)).toBe(1);
    await expect(h.service.countJoinRequests(mine.member, mine.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      h.service.countJoinRequests(mine.owner, theirs.communityId),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("never shows another community's requests or lets its staff decide them", async () => {
    const mine = await approvalCast();
    const theirs = await approvalCast();
    const request = await h.service.requestToJoin(theirs.outsider, theirs.communityId, {
      answers: ["Pottery"],
    });

    expect((await h.service.listJoinRequests(mine.owner, mine.communityId)).data).toEqual([]);
    await expect(
      h.service.approveJoinRequest(mine.owner, mine.communityId, request.id),
    ).rejects.toBeInstanceOf(JoinRequestNotFoundError);
    await expect(h.service.listJoinRequests(mine.owner, theirs.communityId)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("hides other people's requests from a requester at the database level", async () => {
    const cast = await approvalCast();
    await h.service.requestToJoin(cast.outsider, cast.communityId, { answers: ["Pottery"] });
    const other = await insertUser(h.admin);

    const visible = await h.admin.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${manageProbeRole}`));
      await setRlsValue(tx, "community_id", cast.communityId);
      await setRlsValue(tx, "user_id", other.userId);
      return tx.select().from(membershipRequests);
    });

    expect(visible).toEqual([]);
  });
});

describe("approve and decline", () => {
  it("approves a request into an active membership", async () => {
    const cast = await approvalCast();
    const request = await h.service.requestToJoin(cast.outsider, cast.communityId, {
      answers: ["Pottery"],
    });

    const result = await h.service.approveJoinRequest(
      cast.moderator,
      cast.communityId,
      request.id,
      {
        note: "Welcome in",
      },
    );

    expect(result).toEqual({
      requestId: request.id,
      userId: cast.outsider.userId,
      status: "approved",
    });
    expect(await statusOf(cast, cast.outsider.userId)).toBe("active");
    expect((await h.service.getJoinStatus(cast.outsider, cast.communityId)).request).toMatchObject({
      status: "approved",
      decisionNote: "Welcome in",
    });
    expect(await auditActions(h.admin, cast.communityId)).toContain("join_request.approved");
    const events = await h.admin
      .select({ payload: outbox.payload })
      .from(outbox)
      .where(and(eq(outbox.communityId, cast.communityId), eq(outbox.topic, membershipEventsTopic)))
      .orderBy(outbox.createdAt);
    expect(events.map((row) => row.payload)).toEqual([
      {
        events: [
          {
            type: "join_request.created",
            payload: {
              communityId: cast.communityId,
              requestId: request.id,
              userId: cast.outsider.userId,
            },
          },
        ],
      },
      {
        events: [
          {
            type: "join_request.decided",
            payload: {
              communityId: cast.communityId,
              requestId: request.id,
              userId: cast.outsider.userId,
              decidedBy: cast.moderator.userId,
              status: "approved",
            },
          },
        ],
      },
    ]);
    await expect(
      h.service.declineJoinRequest(cast.owner, cast.communityId, request.id),
    ).rejects.toBeInstanceOf(JoinRequestNotFoundError);
  });

  it("declines a request with an optional note and lets the person ask again", async () => {
    const cast = await approvalCast();
    const request = await h.service.requestToJoin(cast.outsider, cast.communityId, {
      answers: ["Pottery"],
    });

    await h.service.declineJoinRequest(cast.admin, cast.communityId, request.id, {
      note: "Members only for staff",
    });

    expect(await statusOf(cast, cast.outsider.userId)).toBeUndefined();
    expect((await h.service.getJoinStatus(cast.outsider, cast.communityId)).request).toMatchObject({
      status: "declined",
      decisionNote: "Members only for staff",
    });
    const retry = await h.service.requestToJoin(cast.outsider, cast.communityId, {
      answers: ["Glazing"],
    });
    expect(retry.id).not.toBe(request.id);
  });

  it("refuses a member and refuses approval once the member limit is reached", async () => {
    const cast = await approvalCast(limited);
    const request = await limited.service.requestToJoin(cast.outsider, cast.communityId, {
      answers: ["Pottery"],
    });
    await insertMember(limited.admin, cast.communityId);

    await expect(
      limited.service.approveJoinRequest(cast.member, cast.communityId, request.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      limited.service.approveJoinRequest(cast.owner, cast.communityId, request.id),
    ).rejects.toBeInstanceOf(LimitReachedError);
  });
});

describe("invite links and approval", () => {
  it("lets a default invite link skip approval", async () => {
    const cast = await approvalCast();
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);

    const result = await h.service.redeemInvite(cast.outsider, invite.token);

    expect(result.membership?.status).toBe("active");
    expect(result.request).toBeNull();
  });

  it("turns an invite that requires approval into a pending request", async () => {
    const cast = await approvalCast(h, "invite");
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId, {
      requiresApproval: true,
    });

    const result = await h.service.redeemInvite(cast.outsider, invite.token);
    const again = await h.service.redeemInvite(cast.outsider, invite.token);

    expect(invite.requiresApproval).toBe(true);
    expect(result.membership).toBeNull();
    expect(result.request?.status).toBe("pending");
    expect(again.request?.id).toBe(result.request?.id);
    expect(await statusOf(cast, cast.outsider.userId)).toBeUndefined();
    const queue = await h.service.listJoinRequests(cast.owner, cast.communityId);
    expect(queue.data.map((item) => item.userId)).toEqual([cast.outsider.userId]);
  });
});
