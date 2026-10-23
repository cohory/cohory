import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  newId,
  withCommunity,
} from "@cohory/db";
import { membershipPlans, paymentConnections, users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PaidSeedRefusedError, seedDevPaidPayments } from "./seed-paid";
import { createFakeGateway, type FakeGateway } from "./test/fake-gateway";
import { cloudEnv, communityEnv, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const env = cloudEnv({ platformFeeBps: 200 });

let gateway: FakeGateway;
let accountId: string;
let ownerEmail: string;
let communityId: string;
const slug = communitySlugSchema.parse(`paid-seed-${newId().slice(-12)}`);

async function addOwnedCommunity(): Promise<void> {
  ownerEmail = `paid-owner-${newId()}@example.test`;
  const [owner] = await db
    .insert(users)
    .values({ name: "Paid owner", email: ownerEmail })
    .returning({ id: users.id });
  const community = await createCommunity(db, { slug, name: "Paid", privacy: "private" });
  communityId = community.id;
  if (!owner) {
    throw new Error("owner insert returned no row");
  }
  await addMembership(withCommunity(db, community.id), {
    userId: owner.id,
    role: "owner",
    status: "active",
    joinedAt: new Date(),
  });
}

beforeAll(async () => {
  gateway = createFakeGateway();
  accountId = `acct_seed${newId().slice(-10)}`;
  gateway.accounts.set(accountId, {
    id: accountId,
    chargesEnabled: true,
    detailsSubmitted: true,
    livemode: false,
    country: "us",
  });
  await addOwnedCommunity();
});

afterAll(async () => {
  await close();
});

function seed(overrides: Partial<Parameters<typeof seedDevPaidPayments>[0]> = {}) {
  return seedDevPaidPayments({
    db,
    env,
    gateway,
    accountId,
    communitySlug: slug,
    ownerEmail,
    ...overrides,
  });
}

describe("seedDevPaidPayments", () => {
  it("connects the account and provisions the plan through the normal plan path", async () => {
    const result = await seed();

    expect(result).toMatchObject({
      communityId,
      accountId,
      connectionCreated: true,
      planCreated: true,
      platformFeeBps: 200,
    });
    expect(result.productId).toMatch(/^prod_/);
    expect(result.monthlyPriceId).toMatch(/^price_/);
    expect(result.annualPriceId).toMatch(/^price_/);
    const [connection] = await db
      .select()
      .from(paymentConnections)
      .where(eq(paymentConnections.communityId, communityId));
    expect(connection).toMatchObject({
      provider: "stripe_connect",
      externalAccountId: accountId,
      status: "active",
      chargesEnabled: true,
    });
    const keys = gateway.calls
      .filter((call) => call.method === "createProduct" || call.method === "createPrice")
      .map((call) => [call.account, call.idempotencyKey]);
    expect(keys).toEqual([
      [accountId, `plan:${result.planId}:product`],
      [accountId, `plan:${result.planId}:price:month`],
      [accountId, `plan:${result.planId}:price:year`],
    ]);
    expect(gateway.calls.find((call) => call.method === "createProduct")?.input).toMatchObject({
      metadata: { cohory_community_id: communityId, cohory_plan_id: result.planId },
    });
  });

  it("finds the connection and plan on a second run and creates nothing", async () => {
    const first = await db
      .select()
      .from(membershipPlans)
      .where(eq(membershipPlans.communityId, communityId));
    const writesBefore = gateway.calls.length;

    const again = await seed();

    expect(again).toMatchObject({ connectionCreated: false, planCreated: false });
    expect(gateway.calls.slice(writesBefore).map((call) => call.method)).toEqual([]);
    expect(
      await db.select().from(membershipPlans).where(eq(membershipPlans.communityId, communityId)),
    ).toEqual(first);
  });

  it("refuses an account that cannot take charges and says why", async () => {
    const pending = `acct_pending${newId().slice(-8)}`;
    gateway.accounts.set(pending, {
      id: pending,
      chargesEnabled: false,
      detailsSubmitted: false,
      livemode: false,
      country: "us",
    });
    await expect(seed({ accountId: pending })).rejects.toThrow(/cannot take charges yet/);
  });

  it("refuses the Community Edition", async () => {
    await expect(seed({ env: communityEnv() })).rejects.toThrow(PaidSeedRefusedError);
  });

  it("refuses a community that the base seed did not create", async () => {
    await expect(
      seed({ communitySlug: communitySlugSchema.parse(`missing-${newId().slice(-12)}`) }),
    ).rejects.toThrow(/run pnpm db:seed first/);
  });
});
