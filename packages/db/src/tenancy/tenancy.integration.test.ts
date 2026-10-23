import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCommunity, getCommunityBySlug } from "../repositories/communities";
import {
  addMembership,
  getMembershipRole,
  listMembershipsForCommunity,
} from "../repositories/memberships";
import { insertUser, openTestDb, uniqueSlug } from "../test/fixtures";
import { TenantScopeRequiredError, withCommunity, type CommunityScope } from "./scope";

const { db, close } = openTestDb();
const uniqueViolation = { cause: { code: "23505" } };

let scopeA: CommunityScope;
let scopeB: CommunityScope;
let userInA: string;
let userInB: string;

beforeAll(async () => {
  const a = await createCommunity(db, { slug: uniqueSlug("alpha"), name: "Alpha" });
  const b = await createCommunity(db, { slug: uniqueSlug("bravo"), name: "Bravo" });
  scopeA = withCommunity(db, a.id);
  scopeB = withCommunity(db, b.id);
  userInA = await insertUser(db);
  userInB = await insertUser(db);
  await addMembership(scopeA, { userId: userInA, role: "owner", status: "active" });
  await addMembership(scopeB, { userId: userInB, role: "owner", status: "active" });
  await addMembership(scopeB, { userId: userInA, role: "member", status: "active" });
});

afterAll(async () => {
  await close();
});

describe("communities repository", () => {
  it("finds a community by slug", async () => {
    const slug = uniqueSlug("charlie");
    const created = await createCommunity(db, { slug, name: "Charlie" });

    const found = await getCommunityBySlug(db, slug);

    expect(found?.id).toBe(created.id);
    expect(found?.levelNames).toHaveLength(9);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getCommunityBySlug(db, uniqueSlug("missing"))).toBeNull();
  });

  it("rejects a duplicate slug", async () => {
    const slug = uniqueSlug("delta");
    await createCommunity(db, { slug, name: "Delta" });

    await expect(createCommunity(db, { slug, name: "Delta again" })).rejects.toMatchObject(
      uniqueViolation,
    );
  });
});

describe("membership scoping", () => {
  it("rejects an insert without a community scope at runtime", async () => {
    const userId = await insertUser(db);
    await expect(
      // @ts-expect-error a scope is required, this simulates an untyped caller
      addMembership(undefined, { userId, status: "active" }),
    ).rejects.toBeInstanceOf(TenantScopeRequiredError);
  });

  it("rejects a forged scope at runtime", async () => {
    const userId = await insertUser(db);
    const forged = JSON.parse('{"kind":"community","communityId":"not-a-uuid"}') as CommunityScope;

    await expect(addMembership(forged, { userId, status: "active" })).rejects.toBeInstanceOf(
      TenantScopeRequiredError,
    );
  });

  it("rejects an insert without a scope or with a caller supplied community id at compile time", () => {
    const typeChecks = (userId: string): void => {
      // @ts-expect-error a scope argument is required
      void addMembership({ userId, status: "active" });
      // @ts-expect-error community_id comes from the scope, never from input
      void addMembership(scopeA, { userId, status: "active", communityId: scopeB.communityId });
    };

    expect(typeChecks).toBeTypeOf("function");
  });

  it("lists only memberships of the scoped community", async () => {
    const inA = await listMembershipsForCommunity(scopeA);
    const inB = await listMembershipsForCommunity(scopeB);

    expect(inA.map((m) => m.userId)).toEqual([userInA]);
    expect(inA.every((m) => m.communityId === scopeA.communityId)).toBe(true);
    expect(inB.map((m) => m.userId).sort()).toEqual([userInA, userInB].sort());
    expect(inB.every((m) => m.communityId === scopeB.communityId)).toBe(true);
  });

  it("returns the role only within the scoped community", async () => {
    expect(await getMembershipRole(scopeA, userInA)).toBe("owner");
    expect(await getMembershipRole(scopeB, userInA)).toBe("member");
    expect(await getMembershipRole(scopeA, userInB)).toBeNull();
  });

  it("returns null for a membership that is not active", async () => {
    const pending = await insertUser(db);
    await addMembership(scopeA, { userId: pending, status: "pending" });

    expect(await getMembershipRole(scopeA, pending)).toBeNull();
  });

  it("enforces one membership per user per community", async () => {
    await expect(
      addMembership(scopeA, { userId: userInA, status: "active" }),
    ).rejects.toMatchObject(uniqueViolation);
  });

  it("enforces one owner per community", async () => {
    const second = await insertUser(db);

    await expect(
      addMembership(scopeA, { userId: second, role: "owner", status: "active" }),
    ).rejects.toMatchObject(uniqueViolation);
  });
});
