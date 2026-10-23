import { ForbiddenError, UnauthenticatedError, type Actor } from "@cohory/authz";
import type { CommunityId, Database } from "@cohory/db";
import { paymentConnections, paymentExitRuns } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cloudEnv, insertMember, insertUser, openProbeDb, openTestDb, user } from "./test/fixtures";
import {
  createHarness,
  mirrorSubscription,
  setupPaidCommunity,
  type Harness,
  type PaidCommunity,
} from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

interface Setup {
  readonly harness: Harness;
  readonly paid: PaidCommunity;
  readonly actors: Readonly<Record<string, Actor>>;
}

async function setup(): Promise<Setup> {
  const harness = createHarness(probe.db, cloudEnv());
  const paid = await setupPaidCommunity(admin.db, harness, "private");
  const other = await setupPaidCommunity(admin.db, harness, "private");
  await mirrorSubscription(admin.db, paid.communityId, { userId: paid.memberId });
  const moderatorId = await insertMember(admin.db, paid.communityId, "moderator");
  return {
    harness,
    paid,
    actors: {
      admin: user(paid.adminId),
      moderator: user(moderatorId),
      member: user(paid.memberId),
      "signed in non member": user(await insertUser(admin.db)),
      "owner of another community": user(other.ownerId),
      guest: { kind: "guest" },
    },
  };
}

async function connectionStatus(communityId: CommunityId): Promise<string | undefined> {
  const [row] = await admin.db
    .select({ status: paymentConnections.status })
    .from(paymentConnections)
    .where(eq(paymentConnections.communityId, communityId));
  return row?.status;
}

async function exitRunCount(communityId: CommunityId): Promise<number> {
  const rows = await admin.db
    .select({ id: paymentExitRuns.id })
    .from(paymentExitRuns)
    .where(eq(paymentExitRuns.communityId, communityId));
  return rows.length;
}

type Operation = (harness: Harness, actor: Actor, communityId: string) => Promise<unknown>;

const ownerOnly: Readonly<Record<string, Operation>> = {
  disconnectStripe: (h, actor, id) =>
    h.service.disconnectStripe(actor, id, { memberChoice: "wind_down" }),
  forceDisconnect: (h, actor, id) => h.service.forceDisconnect(actor, id),
  retryExitRun: (h, actor, id) => h.service.retryExitRun(actor, id),
  keepPaymentAccount: (h, actor, id) => h.service.keepPaymentAccount(actor, id),
  getOwnershipReview: (h, actor, id) => h.service.getOwnershipReview(actor, id),
};

const deniedForOwnerOnly = [
  "admin",
  "moderator",
  "member",
  "signed in non member",
  "owner of another community",
  "guest",
];

const deniedForSummary = [
  "moderator",
  "member",
  "signed in non member",
  "owner of another community",
  "guest",
];

function isDenied(error: unknown): boolean {
  return error instanceof ForbiddenError || error instanceof UnauthenticatedError;
}

describe("authorization on safe exit payment operations", () => {
  for (const [name, operation] of Object.entries(ownerOnly)) {
    for (const who of deniedForOwnerOnly) {
      it(`refuses ${name} for ${who} and writes nothing to Stripe`, async () => {
        const { harness, paid, actors } = await setup();
        const actor = actors[who];
        if (!actor) throw new Error(`no actor ${who}`);

        const outcome = await operation(harness, actor, paid.communityId).then(
          () => null,
          (error: unknown) => error,
        );

        expect(isDenied(outcome)).toBe(true);
        expect(harness.gateway.writes("clearSubscriptionApplicationFee")).toEqual([]);
        expect(harness.gateway.writes("scheduleCancellation")).toEqual([]);
        expect(harness.gateway.writes("cancelSubscription")).toEqual([]);
        expect(await connectionStatus(paid.communityId)).toBe("active");
        expect(await exitRunCount(paid.communityId)).toBe(0);
      });
    }
  }

  for (const who of deniedForSummary) {
    it(`refuses the paid members summary for ${who}`, async () => {
      const { harness, paid, actors } = await setup();
      const actor = actors[who];
      if (!actor) throw new Error(`no actor ${who}`);

      const outcome = await harness.service.getPaidMembersSummary(actor, paid.communityId).then(
        () => null,
        (error: unknown) => error,
      );

      expect(isDenied(outcome)).toBe(true);
    });
  }

  it("gives the owner and an admin the paid members summary of their own community", async () => {
    const { harness, paid } = await setup();

    const forOwner = await harness.service.getPaidMembersSummary(
      user(paid.ownerId),
      paid.communityId,
    );
    const forAdmin = await harness.service.getPaidMembersSummary(
      user(paid.adminId),
      paid.communityId,
    );

    expect(forOwner).toEqual(forAdmin);
  });
});
