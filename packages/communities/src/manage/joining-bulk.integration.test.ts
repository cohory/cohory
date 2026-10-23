import { ForbiddenError } from "@cohory/authz";
import { memberships, membershipRequests } from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityNotFoundError, CommunityValidationError } from "../errors";
import {
  auditActions,
  insertCast,
  insertUser,
  openManageHarness,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

interface Queue {
  readonly cast: Cast;
  readonly requestIds: string[];
  readonly userIds: string[];
}

async function queue(size = 3): Promise<Queue> {
  const cast = await insertCast(h.admin);
  await h.service.updateSettings(cast.owner, cast.communityId, { joinMode: "approval" });
  const requestIds: string[] = [];
  const userIds: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const person = await insertUser(h.admin, `Asker ${index}`);
    const request = await h.service.requestToJoin(person, cast.communityId);
    requestIds.push(request.id);
    userIds.push(person.userId);
  }
  return { cast, requestIds, userIds };
}

async function statusOf(cast: Cast, userId: string): Promise<string | undefined> {
  const [row] = await h.admin
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.communityId, cast.communityId), eq(memberships.userId, userId)));
  return row?.status;
}

async function requestStatus(requestId: string): Promise<string | undefined> {
  const [row] = await h.admin
    .select({ status: membershipRequests.status })
    .from(membershipRequests)
    .where(eq(membershipRequests.id, requestId));
  return row?.status;
}

describe("decideJoinRequests", () => {
  it.each(["owner", "admin", "moderator"] as const)(
    "lets the %s approve several requests at once",
    async (role) => {
      const { cast, requestIds, userIds } = await queue();

      const result = await h.service.decideJoinRequests(cast[role], cast.communityId, {
        requestIds,
        decision: "approve",
      });

      expect(result).toEqual({ done: requestIds, failed: [] });
      for (const userId of userIds) {
        expect(await statusOf(cast, userId)).toBe("active");
      }
      expect(
        (await auditActions(h.admin, cast.communityId)).filter(
          (action) => action === "join_request.approved",
        ),
      ).toHaveLength(3);
    },
  );

  it("declines several requests without creating memberships", async () => {
    const { cast, requestIds, userIds } = await queue(2);

    const result = await h.service.decideJoinRequests(cast.moderator, cast.communityId, {
      requestIds,
      decision: "decline",
    });

    expect(result.done).toEqual(requestIds);
    for (const [index, requestId] of requestIds.entries()) {
      expect(await requestStatus(requestId)).toBe("declined");
      expect(await statusOf(cast, userIds[index] ?? "")).not.toBe("active");
    }
  });

  it("reports requests that were already decided and decides the rest", async () => {
    const { cast, requestIds } = await queue(2);
    const [first, second] = requestIds;
    await h.service.declineJoinRequest(cast.owner, cast.communityId, first ?? "");

    const result = await h.service.decideJoinRequests(cast.owner, cast.communityId, {
      requestIds,
      decision: "approve",
    });

    expect(result).toEqual({ done: [second], failed: [{ id: first, code: "not_found" }] });
  });

  it("refuses a regular member and leaves every request pending", async () => {
    const { cast, requestIds } = await queue(2);

    await expect(
      h.service.decideJoinRequests(cast.member, cast.communityId, {
        requestIds,
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const requestId of requestIds) {
      expect(await requestStatus(requestId)).toBe("pending");
    }
  });

  it("refuses another community's staff and never decides its requests", async () => {
    const mine = await queue(1);
    const theirs = await queue(1);

    await expect(
      h.service.decideJoinRequests(theirs.cast.owner, mine.cast.communityId, {
        requestIds: mine.requestIds,
        decision: "approve",
      }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);

    const crossed = await h.service.decideJoinRequests(mine.cast.owner, mine.cast.communityId, {
      requestIds: theirs.requestIds,
      decision: "approve",
    });

    expect(crossed).toEqual({
      done: [],
      failed: [{ id: theirs.requestIds[0], code: "not_found" }],
    });
    expect(await requestStatus(theirs.requestIds[0] ?? "")).toBe("pending");
  });

  it("rejects an empty selection and ids that are not uuids", async () => {
    const { cast } = await queue(1);

    for (const requestIds of [[], ["nope"]]) {
      await expect(
        h.service.decideJoinRequests(cast.owner, cast.communityId, {
          requestIds,
          decision: "approve",
        }),
      ).rejects.toBeInstanceOf(CommunityValidationError);
    }
  });
});
