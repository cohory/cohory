import {
  hasPaidTransactionSince,
  newId,
  rlsSettingName,
  runInCommunity,
  setCommunityCurrency,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { feeLedgerEntries, payments } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { communityKey } from "@cohory/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  insertCast,
  insertUser,
  openManageHarness,
  type ManageHarness,
} from "../test/manage-fixtures";

let limited: ManageHarness;
let open: ManageHarness;
let tiered: ManageHarness;

const dayMs = 24 * 60 * 60 * 1000;

async function insertPayment(
  communityId: CommunityId,
  daysAgo: number,
  amountMinor: number,
  refundedMinor = 0,
): Promise<string> {
  const [row] = await tiered.admin
    .insert(payments)
    .values({
      communityId,
      externalInvoiceId: `in_${newId()}`,
      currency: "usd",
      amountMinor,
      refundedMinor,
      occurredAt: new Date(Date.now() - daysAgo * dayMs),
    })
    .returning({ id: payments.id });
  if (!row) throw new Error("payment not inserted");
  return row.id;
}

async function insertLedgerEntry(
  communityId: CommunityId,
  kind: "fee_accrued" | "fee_collected" | "adjustment",
  daysAgo: number,
  paymentId: string | null = null,
): Promise<void> {
  await tiered.admin.insert(feeLedgerEntries).values({
    communityId,
    paymentId,
    kind,
    provider: "stripe_own_keys",
    collectionMethod: "periodic_invoice",
    currency: "usd",
    baseMinor: 2000,
    rateBps: 200,
    computedFeeMinor: kind === "adjustment" ? 0 : 20,
    idempotencyKey: `ledger-${newId()}`,
    occurredAt: new Date(Date.now() - daysAgo * dayMs),
  });
}

beforeAll(async () => {
  limited = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_MEMBERS: "4", FAIR_USE_STORAGE_BYTES: "1000" }),
  });
  open = await openManageHarness({ fairUse: parseFairUseEnv({}) });
  tiered = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_MEMBERS: "4", FAIR_USE_PAID_MEMBERS: "unlimited" }),
  });
});

afterAll(async () => {
  await limited.close();
  await open.close();
  await tiered.close();
});

describe("fair use at invite redemption", () => {
  it("refuses a new member once the community has reached its member limit", async () => {
    const cast = await insertCast(limited.admin);
    const invite = await limited.service.createInviteLink(cast.admin, cast.communityId);

    const error = await limited.service
      .redeemInvite(cast.outsider, invite.token)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "members", limit: 4, used: 4 });
    const membership = await limited.service.redeemInvite(cast.member, invite.token);
    expect(membership.membership?.status).toBe("active");
  });

  it("lets members in when the edition has no member limit", async () => {
    const cast = await insertCast(open.admin);
    const invite = await open.service.createInviteLink(cast.admin, cast.communityId);
    const result = await open.service.redeemInvite(await insertUser(open.admin), invite.token);
    expect(result.membership?.status).toBe("active");
  });
});

describe("getUsage", () => {
  it("reports active members and stored bytes against the limits", async () => {
    const cast = await insertCast(limited.admin);
    limited.storage.objects.set(communityKey(cast.communityId, "posts", "a.png"), {
      key: communityKey(cast.communityId, "posts", "a.png"),
      body: new Uint8Array(850),
      contentType: "image/png",
    });

    const usage = await limited.service.getUsage(cast.admin, cast.communityId);

    expect(usage).toEqual({
      tier: "free",
      members: { used: 4, limit: 4, state: "reached" },
      storageBytes: { used: 850, limit: 1000, state: "near" },
      uploadBytes: null,
    });
  });

  it("is only available to people who can read settings", async () => {
    const cast = await insertCast(limited.admin);
    await expect(limited.service.getUsage(cast.member, cast.communityId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("branding uploads", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  ]);

  it("count toward storage and are refused once the community is full", async () => {
    const cast = await insertCast(limited.admin);
    limited.storage.objects.set(communityKey(cast.communityId, "posts", "big.png"), {
      key: communityKey(cast.communityId, "posts", "big.png"),
      body: new Uint8Array(990),
      contentType: "image/png",
    });

    const error = await limited.service
      .uploadBranding(cast.owner, cast.communityId, "logo", {
        bytes: png,
        declaredType: "image/png",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "storage", limit: 1000, used: 990 });
  });

  it("are stored under the community folder, so usage includes them", async () => {
    const cast = await insertCast(limited.admin);
    await limited.service.uploadBranding(cast.owner, cast.communityId, "logo", {
      bytes: png,
      declaredType: "image/png",
    });

    const usage = await limited.service.getUsage(cast.admin, cast.communityId);

    expect(usage.storageBytes.used).toBe(png.byteLength);
  });
});

describe("paid tier", () => {
  it("applies paid limits after a paid transaction in the last 90 days", async () => {
    const cast = await insertCast(tiered.admin);
    await insertPayment(cast.communityId, 10, 500);

    const usage = await tiered.service.getUsage(cast.admin, cast.communityId);
    expect(usage.tier).toBe("paid");
    expect(usage.members.limit).toBeNull();

    const invite = await tiered.service.createInviteLink(cast.admin, cast.communityId);
    const result = await tiered.service.redeemInvite(cast.outsider, invite.token);
    expect(result.membership?.status).toBe("active");
  });

  it("counts a collected or accrued platform fee entry as a paid transaction", async () => {
    const collected = await insertCast(tiered.admin);
    await insertLedgerEntry(collected.communityId, "fee_collected", 3);
    const accrued = await insertCast(tiered.admin);
    await insertLedgerEntry(accrued.communityId, "fee_accrued", 89);

    expect((await tiered.service.getUsage(collected.admin, collected.communityId)).tier).toBe(
      "paid",
    );
    expect((await tiered.service.getUsage(accrued.admin, accrued.communityId)).tier).toBe("paid");
  });

  it("falls back to free limits when the last paid transaction is older than 90 days", async () => {
    const cast = await insertCast(tiered.admin);
    await insertPayment(cast.communityId, 91, 500);
    await insertLedgerEntry(cast.communityId, "fee_collected", 120);

    const usage = await tiered.service.getUsage(cast.admin, cast.communityId);
    expect(usage).toMatchObject({ tier: "free", members: { limit: 4 } });
  });

  it("does not count a price alone, a zero amount, a full refund, or an adjustment", async () => {
    const cast = await insertCast(tiered.admin);
    await runInCommunity(withCommunity(tiered.admin, cast.communityId), (queries) =>
      setCommunityCurrency(queries, "usd"),
    );
    await insertPayment(cast.communityId, 1, 0);
    await insertPayment(cast.communityId, 1, 500, 500);
    await insertLedgerEntry(cast.communityId, "adjustment", 1);

    const usage = await tiered.service.getUsage(cast.admin, cast.communityId);
    expect(usage.tier).toBe("free");
  });

  it("does not count the platform fee of a payment that was refunded in full", async () => {
    const refunded = await insertCast(tiered.admin);
    const refundedPayment = await insertPayment(refunded.communityId, 2, 2000, 2000);
    await insertLedgerEntry(refunded.communityId, "fee_accrued", 2, refundedPayment);
    const partial = await insertCast(tiered.admin);
    const partialPayment = await insertPayment(partial.communityId, 2, 2000, 1000);
    await insertLedgerEntry(partial.communityId, "fee_collected", 2, partialPayment);

    expect((await tiered.service.getUsage(refunded.admin, refunded.communityId)).tier).toBe("free");
    expect((await tiered.service.getUsage(partial.admin, partial.communityId)).tier).toBe("paid");
  });

  it("refuses a new member at the free limit when no paid transaction is recent", async () => {
    const cast = await insertCast(tiered.admin);
    const invite = await tiered.service.createInviteLink(cast.admin, cast.communityId);
    await expect(tiered.service.redeemInvite(cast.outsider, invite.token)).rejects.toBeInstanceOf(
      LimitReachedError,
    );
  });
});

describe("hasPaidTransactionSince", () => {
  it("restores the payments manager setting it borrowed for the lookup", async () => {
    const cast = await insertCast(tiered.admin);
    await insertPayment(cast.communityId, 1, 500);
    const setting = await runInCommunity(
      withCommunity(tiered.app, cast.communityId),
      async (queries) => {
        const found = await hasPaidTransactionSince(queries, new Date(Date.now() - 90 * dayMs));
        const { rows } = await queries.tx.execute<{ value: string | null }>(
          sql`select current_setting(${rlsSettingName("payments_manager")}, true) as value`,
        );
        return { found, value: rows[0]?.value ?? "" };
      },
    );
    expect(setting).toEqual({ found: true, value: "" });
  });
});
