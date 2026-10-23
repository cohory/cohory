import type { Database } from "@cohory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NoBillingAccountError } from "./errors";
import { cloudEnv, insertMember, insertUser, openProbeDb, openTestDb, user } from "./test/fixtures";
import { createHarness, mirrorSubscription, setupPaidCommunity } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

function returnUrlOf(write: unknown): string | undefined {
  if (typeof write !== "object" || write === null || !("input" in write)) return undefined;
  const input = write.input;
  if (typeof input !== "object" || input === null || !("returnUrl" in input)) return undefined;
  return typeof input.returnUrl === "string" ? input.returnUrl : undefined;
}

describe("billing management from the account billing page", () => {
  it("returns the member to the community membership page by default", async () => {
    const harness = createHarness(probe.db, cloudEnv());
    const paid = await setupPaidCommunity(admin.db, harness);
    await mirrorSubscription(admin.db, paid.communityId, { userId: paid.memberId });

    await harness.service.createPortalSession(user(paid.memberId), paid.communityId);

    const [write] = harness.gateway.writes("createPortalSession");
    expect(returnUrlOf(write)).toMatch(/\/c\/[^/]+\/membership$/);
  });

  it("returns the member to /account/billing when opened from the account billing page", async () => {
    const harness = createHarness(probe.db, cloudEnv());
    const paid = await setupPaidCommunity(admin.db, harness);
    await mirrorSubscription(admin.db, paid.communityId, { userId: paid.memberId });

    await harness.service.createPortalSession(user(paid.memberId), paid.communityId, {
      returnTo: "account",
    });

    const [write] = harness.gateway.writes("createPortalSession");
    expect(returnUrlOf(write)).toBe("http://localhost:3000/account/billing");
  });

  it("opens billing management from the membership page and then the account page within the same minute", async () => {
    const harness = createHarness(probe.db, cloudEnv());
    const paid = await setupPaidCommunity(admin.db, harness);
    await mirrorSubscription(admin.db, paid.communityId, { userId: paid.memberId });

    await harness.service.createPortalSession(user(paid.memberId), paid.communityId);
    await harness.service.createPortalSession(user(paid.memberId), paid.communityId, {
      returnTo: "account",
    });
    await harness.service.createPortalSession(user(paid.memberId), paid.communityId);

    const keys = harness.gateway.writes("createPortalSession").map((call) => call.idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });

  it("opens billing management for a member removed from a private community whose subscription still bills", async () => {
    const harness = createHarness(probe.db, cloudEnv());
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const removedId = await insertMember(admin.db, paid.communityId, "member", "removed");
    await mirrorSubscription(admin.db, paid.communityId, { userId: removedId });

    const portal = await harness.service.createPortalSession(user(removedId), paid.communityId, {
      returnTo: "account",
    });

    expect(portal.url).toContain("cus_mirror");
  });

  it("refuses a signed in person with no billing account in that community", async () => {
    const harness = createHarness(probe.db, cloudEnv());
    const paid = await setupPaidCommunity(admin.db, harness, "private");
    const strangerId = await insertUser(admin.db);

    await expect(
      harness.service.createPortalSession(user(strangerId), paid.communityId, {
        returnTo: "account",
      }),
    ).rejects.toBeInstanceOf(NoBillingAccountError);
    expect(harness.gateway.writes("createPortalSession")).toEqual([]);
  });
});
