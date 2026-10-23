import { ForbiddenError } from "@cohory/authz";
import { communities } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommunityNotFoundError } from "../errors";
import type { BeginArchiveInput, PaidExitPort } from "./paid-exit";
import {
  insertCast,
  openManageHarness,
  unpaidExit,
  type ManageHarness,
} from "../test/manage-fixtures";

interface Recorded extends BeginArchiveInput {
  readonly archivedWhenCalled: boolean;
}

let h: ManageHarness;
const calls: Recorded[] = [];
let failNext: Error | null = null;
const deletionCalls: string[] = [];

const paidExit: PaidExitPort = {
  ...unpaidExit,
  async beginArchive(input) {
    const [row] = await h.admin
      .select({ archivedAt: communities.archivedAt })
      .from(communities)
      .where(eq(communities.id, input.communityId));
    calls.push({ ...input, archivedWhenCalled: row?.archivedAt != null });
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
  },
  async beginDeletion(input) {
    deletionCalls.push(input.communityId);
    return unpaidExit.beginDeletion(input);
  },
};

beforeAll(async () => {
  h = await openManageHarness({ paidExit });
});

afterAll(async () => {
  await h.close();
});

describe("archive and paid members", () => {
  it("archives first and then starts the paid member run", async () => {
    const cast = await insertCast(h.admin);
    calls.length = 0;

    const view = await h.service.archiveCommunity(cast.owner, cast.communityId);

    expect(view.archivedAt).not.toBeNull();
    expect(calls).toEqual([
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        choice: "stop_at_period_end",
        includeLinked: true,
        archivedWhenCalled: true,
      },
    ]);
  });

  it("passes the owner's choice and the linked import option", async () => {
    const cast = await insertCast(h.admin);
    calls.length = 0;

    await h.service.archiveCommunity(cast.owner, cast.communityId, {
      paidMembers: "keep_billing",
      includeLinked: false,
    });

    expect(calls[0]).toMatchObject({ choice: "keep_billing", includeLinked: false });
  });

  it("lets the owner switch keep billing to stop at period end while archived", async () => {
    const cast = await insertCast(h.admin);
    calls.length = 0;

    await h.service.archiveCommunity(cast.owner, cast.communityId, { paidMembers: "keep_billing" });
    const again = await h.service.archiveCommunity(cast.owner, cast.communityId, {
      paidMembers: "stop_at_period_end",
    });

    expect(again.archivedAt).not.toBeNull();
    expect(calls.map((call) => call.choice)).toEqual(["keep_billing", "stop_at_period_end"]);
  });

  it("starts no run when an admin tries to archive", async () => {
    const cast = await insertCast(h.admin);
    calls.length = 0;

    await expect(h.service.archiveCommunity(cast.admin, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(calls).toEqual([]);
  });

  it("refuses archive and delete to a moderator, a member, an outsider, and another community's owner without starting a run", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await h.admin
      .update(communities)
      .set({ archivedAt: new Date("2026-10-19T10:00:00Z") })
      .where(eq(communities.id, cast.communityId));
    calls.length = 0;
    deletionCalls.length = 0;

    for (const actor of [cast.moderator, cast.member]) {
      await expect(h.service.archiveCommunity(actor, cast.communityId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(h.service.deleteCommunity(actor, cast.communityId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    for (const actor of [cast.outsider, other.owner]) {
      await expect(h.service.archiveCommunity(actor, cast.communityId)).rejects.toBeInstanceOf(
        CommunityNotFoundError,
      );
      await expect(h.service.deleteCommunity(actor, cast.communityId)).rejects.toBeInstanceOf(
        CommunityNotFoundError,
      );
    }

    expect(calls).toEqual([]);
    expect(deletionCalls).toEqual([]);
    const [row] = await h.admin
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.id, cast.communityId));
    expect(row?.id).toBe(cast.communityId);
  });

  it("keeps the community archived when the paid member run cannot start", async () => {
    const cast = await insertCast(h.admin);
    failNext = new Error("exit in progress");

    await expect(h.service.archiveCommunity(cast.owner, cast.communityId)).rejects.toThrow(
      "exit in progress",
    );
    const [row] = await h.admin
      .select({ archivedAt: communities.archivedAt })
      .from(communities)
      .where(eq(communities.id, cast.communityId));
    expect(row?.archivedAt).not.toBeNull();
  });

  it("rejects an unknown choice", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.archiveCommunity(cast.owner, cast.communityId, {
        paidMembers: "cancel_now" as "keep_billing",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
