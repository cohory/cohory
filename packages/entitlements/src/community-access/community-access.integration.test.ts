import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  insertMembershipIfAbsent,
  newId,
  parseAdminDatabaseEnv,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import {
  compedMemberships,
  memberStats,
  membershipPlans,
  paymentConnections,
  paymentCustomers,
  subscriptions,
  users,
  type MemberRole,
  type MemberStatus,
  type SubscriptionAccessState,
} from "@cohory/db/schema";

import { communityAccessIn, noCommunityAccess } from "./community-access";
import { memberLevelIn } from "./level-access";

const probeRole = "cohory_access_probe";
const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probeDb = createDb(probePool);
const unpaidProbeRole = "cohory_access_probe_unpaid";
const unpaidProbeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
unpaidProbeUrl.searchParams.set("options", `-c role=${unpaidProbeRole}`);
const unpaidProbePool = createPool(unpaidProbeUrl.toString());
const unpaidProbeDb = createDb(unpaidProbePool);

const now = new Date("2026-10-22T12:00:00.000Z");
const later = new Date("2026-11-22T12:00:00.000Z");
const earlier = new Date("2026-10-01T12:00:00.000Z");

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = '${unpaidProbeRole}') then
        create role ${unpaidProbeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select on communities, memberships, users to ${unpaidProbeRole};
    grant select on communities, memberships, users, subscriptions, payment_connections,
      comped_memberships, membership_plans, member_stats to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await probePool.end();
  await unpaidProbePool.end();
  await pool.end();
});

async function community(): Promise<CommunityId> {
  const slug = communitySlugSchema.parse(`access-${newId().slice(-12)}`);
  return (await createCommunity(db, { slug, name: "Access" })).id;
}

async function insertUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ name: "Access Tester", email: `access-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  return user.id;
}

async function member(
  communityId: CommunityId,
  status: MemberStatus = "active",
  role: MemberRole = "member",
): Promise<string> {
  const userId = await insertUser();
  await insertMembershipIfAbsent(withCommunity(db, communityId), { userId, status, role });
  return userId;
}

interface PaidFacts {
  readonly accessState: SubscriptionAccessState;
  readonly providerStatus: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly currentPeriodEnd?: Date;
  readonly closedAt?: Date;
}

async function subscribe(communityId: CommunityId, userId: string, facts: PaidFacts) {
  await runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "payments_manager");
    const [connection] = await tx
      .insert(paymentConnections)
      .values(
        values({
          provider: "stripe_connect" as const,
          status: facts.closedAt ? ("disconnected" as const) : ("active" as const),
          disconnectedAt: facts.closedAt ?? null,
        }),
      )
      .returning({ id: paymentConnections.id });
    if (!connection) throw new Error("no connection");
    const [customer] = await tx
      .insert(paymentCustomers)
      .values(values({ userId, connectionId: connection.id, externalCustomerId: `cus_${newId()}` }))
      .returning({ id: paymentCustomers.id });
    if (!customer) throw new Error("no customer");
    await tx.insert(subscriptions).values(
      values({
        userId,
        customerId: customer.id,
        connectionId: connection.id,
        externalSubscriptionId: `sub_${newId()}`,
        providerStatus: facts.providerStatus,
        accessState: facts.accessState,
        currentPeriodEnd: facts.currentPeriodEnd ?? later,
        cancelAtPeriodEnd: facts.cancelAtPeriodEnd ?? false,
        applicationFeeBps: 200,
        providerFetchedAt: now,
      }),
    );
    await tx
      .insert(membershipPlans)
      .values(values({ name: "Plan", currency: "usd", monthlyPriceMinor: 1000 }))
      .onConflictDoNothing();
  });
}

async function comp(communityId: CommunityId, userId: string, expiresAt: Date | null) {
  await runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "payments_manager");
    await tx.insert(compedMemberships).values(values({ userId, expiresAt }));
  });
}

function accessOf(communityId: CommunityId, userId: string) {
  return runInCommunity(withCommunity(probeDb, communityId), (queries) =>
    communityAccessIn(queries, userId, now),
  );
}

describe("communityAccessIn", () => {
  it("grants a member whose subscription grants access", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, { accessState: "granted", providerStatus: "active" });

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: true });
  });

  it("keeps a past due member entitled during grace", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, { accessState: "grace", providerStatus: "past_due" });

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: true });
  });

  it("keeps a member who cancelled at period end entitled until the period ends", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, {
      accessState: "granted",
      providerStatus: "active",
      cancelAtPeriodEnd: true,
    });

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: true });
  });

  it("gives nothing once a revoked subscription has removed the membership", async () => {
    const id = await community();
    const userId = await member(id, "removed");
    await subscribe(id, userId, { accessState: "revoked", providerStatus: "canceled" });

    expect(await accessOf(id, userId)).toEqual(noCommunityAccess);
  });

  it("entitles a member with an open comp", async () => {
    const id = await community();
    const userId = await member(id);
    await comp(id, userId, later);

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: true });
  });

  it("denies a member whose billing closed and whose paid access ended", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, {
      accessState: "granted",
      providerStatus: "active",
      currentPeriodEnd: earlier,
      closedAt: earlier,
    });

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: false });
  });

  it("keeps a member entitled after billing closed while a comp is open", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, {
      accessState: "granted",
      providerStatus: "active",
      currentPeriodEnd: earlier,
      closedAt: earlier,
    });
    await comp(id, userId, null);

    expect(await accessOf(id, userId)).toEqual({ role: "member", entitled: true });
  });

  it("gives a banned member nothing", async () => {
    const id = await community();
    const userId = await member(id, "banned");

    expect(await accessOf(id, userId)).toEqual(noCommunityAccess);
  });

  it("does not carry a membership or subscription into another community", async () => {
    const a = await community();
    const b = await community();
    const userId = await member(a);
    await subscribe(a, userId, { accessState: "granted", providerStatus: "active" });

    expect(await accessOf(b, userId)).toEqual(noCommunityAccess);
  });

  it("restores the caller's app.user_id after reading paid facts", async () => {
    const id = await community();
    const userId = await member(id);
    await subscribe(id, userId, { accessState: "granted", providerStatus: "active" });

    const after = await runInCommunity(withCommunity(probeDb, id), async (queries) => {
      await communityAccessIn(queries, userId, now);
      const { rows } = await queries.tx.execute<{ user: string | null }>(
        sql`select current_setting('app.user_id', true) as user`,
      );
      return rows[0]?.user ?? "";
    });

    expect(after).toBe("");
  });

  it("reports the failed paid facts read, not the reset of app.user_id", async () => {
    const id = await community();
    const userId = await member(id);

    const read = runInCommunity(withCommunity(unpaidProbeDb, id), (queries) =>
      communityAccessIn(queries, userId, now),
    );

    await expect(read).rejects.toThrow(/from "subscriptions"/);
  });
});

describe("memberLevelIn", () => {
  async function setLevel(communityId: CommunityId, userId: string, level: number) {
    await runInCommunity(withCommunity(db, communityId), ({ tx, values }) =>
      tx.insert(memberStats).values(values({ userId, pointsTotal: 40, level, updatedAt: now })),
    );
  }

  function levelOf(communityId: CommunityId, userId: string) {
    return runInCommunity(withCommunity(probeDb, communityId), (queries) =>
      memberLevelIn(queries, userId),
    );
  }

  it("reads the member's level in this community", async () => {
    const id = await community();
    const userId = await member(id);
    await setLevel(id, userId, 4);

    expect(await levelOf(id, userId)).toBe(4);
  });

  it("starts a member without points at level 1", async () => {
    const id = await community();
    const userId = await member(id);

    expect(await levelOf(id, userId)).toBe(1);
  });

  it("never reads a level the member earned in another community", async () => {
    const a = await community();
    const b = await community();
    const userId = await member(a);
    await insertMembershipIfAbsent(withCommunity(db, b), {
      userId,
      status: "active",
      role: "member",
    });
    await setLevel(a, userId, 6);

    expect(await levelOf(b, userId)).toBe(1);
  });
});
