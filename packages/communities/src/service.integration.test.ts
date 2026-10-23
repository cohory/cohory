import { ForbiddenError, type Actor } from "@cohory/authz";
import {
  createDb,
  createPool,
  listMembershipsForCommunity,
  newId,
  parseAdminDatabaseEnv,
  withCommunity,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { memberships, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityCreationRestrictedError,
  CommunityNotFoundError,
  OwnerCannotLeaveError,
} from "./errors";
import { createPostgresCommunitiesRepository } from "./postgres-repository";
import { createCommunitiesService } from "./service";
import type { CommunityView } from "./views";

const probeRole = "cohory_communities_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const service = createCommunitiesService(createPostgresCommunitiesRepository(createDb(appPool)));

async function newUser(name = "Person"): Promise<Actor & { kind: "user" }> {
  const [row] = await adminDb
    .insert(users)
    .values({ name, email: `person-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return { kind: "user", userId: row.id, platformAdmin: false };
}

function slug(prefix: string): string {
  return `${prefix}-${newId().slice(-12)}`;
}

let ownerA: Actor & { kind: "user" };
let ownerB: Actor & { kind: "user" };
let communityA: CommunityView;
let communityB: CommunityView;

beforeAll(async () => {
  await adminDb.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select, insert, update, delete on communities, memberships, categories, outbox to ${probeRole};
    grant select on subscriptions, payment_connections, comped_memberships, membership_plans to ${probeRole};
    grant select on users, community_gallery_items to ${probeRole};
  `),
  );
  ownerA = await newUser();
  ownerB = await newUser();
  communityA = (
    await service.createCommunity(ownerA, { name: "Alpha", slug: slug("alpha"), privacy: "public" })
  ).community;
  communityB = (await service.createCommunity(ownerB, { name: "Bravo", slug: slug("bravo") }))
    .community;
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("communities service against Postgres as a non bypass role", () => {
  it("creates the owner membership with the community", async () => {
    const membership = await service.getMembership(ownerA, communityA.id);

    expect(membership).toMatchObject({ role: "owner", status: "active", userId: ownerA.userId });
  });

  it("never shows community B's memberships when listing community A", async () => {
    const member = await newUser();
    await service.joinCommunity(member, communityA.id);

    const rows = await listMembershipsForCommunity(withCommunity(adminDb, communityA.id));

    expect(rows.map((r) => r.userId).sort()).toEqual([ownerA.userId, member.userId].sort());
    expect(rows.every((r) => r.communityId === communityA.id)).toBe(true);
  });

  it("lists only the actor's own communities", async () => {
    const mine = await service.listCommunitiesForUser(ownerA);

    expect(mine.map((r) => r.community.id)).toEqual([communityA.id]);
  });

  it("counts the active members of every listed community", async () => {
    const owner = await newUser();
    const small = (await service.createCommunity(owner, { name: "Aa", slug: slug("small") }))
      .community;
    const big = (await service.createCommunity(owner, { name: "Bb", slug: slug("big") })).community;
    for (let i = 0; i < 3; i += 1) {
      await adminDb
        .insert(memberships)
        .values({ communityId: big.id, userId: (await newUser()).userId, status: "active" });
    }
    await adminDb
      .insert(memberships)
      .values({ communityId: big.id, userId: (await newUser()).userId, status: "removed" });

    const mine = await service.listCommunitiesForUser(owner);

    expect(mine.map((r) => [r.community.id, r.community.memberCount])).toEqual([
      [small.id, 1],
      [big.id, 4],
    ]);
  });

  it("is idempotent when joining twice", async () => {
    const member = await newUser();

    const first = await service.joinCommunity(member, communityA.id);
    const second = await service.joinCommunity(member, communityA.id);

    expect(second.id).toBe(first.id);
    const rows = await listMembershipsForCommunity(withCommunity(adminDb, communityA.id));
    expect(rows.filter((r) => r.userId === member.userId)).toHaveLength(1);
  });

  it("refuses to let the owner leave", async () => {
    await expect(service.leaveCommunity(ownerA, communityA.id)).rejects.toBeInstanceOf(
      OwnerCannotLeaveError,
    );
  });

  it("lets a member leave and rejoin", async () => {
    const member = await newUser();
    await service.joinCommunity(member, communityA.id);

    expect((await service.leaveCommunity(member, communityA.id)).status).toBe("removed");
    expect((await service.joinCommunity(member, communityA.id)).status).toBe("active");
  });

  it("records a dismissed welcome card on the member's row in that community only", async () => {
    const member = await newUser("Dismisser");
    const other = (
      await service.createCommunity(await newUser(), { name: "Other", slug: slug("other") })
    ).community;
    await service.joinCommunity(member, communityA.id);
    await adminDb.insert(memberships).values({
      communityId: other.id,
      userId: member.userId,
      role: "member",
      status: "active",
      joinedAt: new Date(),
    });

    await service.dismissOnboarding(member, communityA.id);

    const rows = await adminDb
      .select({
        communityId: memberships.communityId,
        dismissedAt: memberships.onboardingDismissedAt,
      })
      .from(memberships)
      .where(eq(memberships.userId, member.userId));
    expect(rows.find((row) => row.communityId === communityA.id)?.dismissedAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.communityId === other.id)?.dismissedAt).toBeNull();
    expect((await service.getAccess(member, communityA.id)).onboardingDismissed).toBe(true);
  });

  it("makes an admin who leaves and joins again a plain member", async () => {
    const staff = await newUser();
    await service.joinCommunity(staff, communityA.id);
    await adminDb
      .update(memberships)
      .set({ role: "admin" })
      .where(and(eq(memberships.communityId, communityA.id), eq(memberships.userId, staff.userId)));

    const left = await service.leaveCommunity(staff, communityA.id);
    expect(left).toMatchObject({ status: "removed", role: "member" });

    const rejoined = await service.joinCommunity(staff, communityA.id);
    expect(rejoined).toMatchObject({ status: "active", role: "member" });
  });

  it("shows only the About view of a private community to a guest and another owner", async () => {
    const asGuest = await service.getCommunityBySlug({ kind: "guest" }, communityB.slug);
    const asOtherOwner = await service.getCommunityBySlug(ownerA, communityB.slug);

    expect(asGuest).toMatchObject({ access: "limited", name: "Bravo", memberCount: 1 });
    expect(asOtherOwner.access).toBe("limited");
    expect(asGuest).not.toHaveProperty("createdAt");
    await expect(service.getMembership(ownerA, communityB.id)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("answers not found for an unknown slug", async () => {
    await expect(
      service.getCommunityBySlug({ kind: "guest" }, slug("missing")),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });

  it("finds members by name prefix in SQL and returns at most the limit", async () => {
    const owner = await newUser("Olive Stone");
    const { community } = await service.createCommunity(owner, {
      name: "Charlie",
      slug: slug("charlie"),
      privacy: "public",
    });
    for (const name of ["Zed One", "Zed Two", "Zed Three", "Ana Lopez"]) {
      await service.joinCommunity(await newUser(name), community.id);
    }
    const sams: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const sam = await newUser(`Sam ${i}`);
      sams.push(sam.userId);
      await service.joinCommunity(sam, community.id);
    }

    const page = await service.searchMembersByName(owner, community.id, {
      prefix: "sam",
      limit: 2,
    });
    const joined = await service.searchMembersByName(owner, community.id, {
      prefix: "analo",
      limit: 8,
    });

    expect(page).toHaveLength(2);
    expect(page.every((m) => m.name.startsWith("Sam ") && sams.includes(m.userId))).toBe(true);
    expect(joined.map((m) => [m.name, m.role])).toEqual([["Ana Lopez", "member"]]);
    expect((await service.getCommunityBySlug(owner, community.slug)).memberCount).toBe(9);
  });

  it("refuses to search members for a non member and hides another tenant's members", async () => {
    const outsider = await newUser();
    const search = { prefix: "person", limit: 8 };

    await expect(
      service.searchMembersByName(outsider, communityA.id, search),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.searchMembersByName(ownerA, communityB.id, search)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });

  it("shows a public community to a guest", async () => {
    const view = await service.getCommunityBySlug({ kind: "guest" }, communityA.slug);

    expect(view.id).toBe(communityA.id);
  });
});

describe("community creation limited to operators", () => {
  it("reads the account email to let an operator create a community and refuse anyone else", async () => {
    const operator = await newUser("Operator");
    const [row] = await adminDb
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, operator.userId))
      .returning({ email: users.email });
    const restricted = createCommunitiesService(
      createPostgresCommunitiesRepository(createDb(appPool)),
      { communityCreation: { mode: "operators", operators: [row?.email ?? ""] } },
    );

    const created = await restricted.createCommunity(operator, { name: "Ops", slug: slug("ops") });
    expect(created.membership.role).toBe("owner");
    await expect(
      restricted.createCommunity(await newUser("Stranger"), { name: "No", slug: slug("no") }),
    ).rejects.toBeInstanceOf(CommunityCreationRestrictedError);
    const unconfirmed = await newUser("Unconfirmed");
    const [claim] = await adminDb
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, unconfirmed.userId));
    const claimed = createCommunitiesService(
      createPostgresCommunitiesRepository(createDb(appPool)),
      { communityCreation: { mode: "operators", operators: [claim?.email ?? ""] } },
    );
    await expect(
      claimed.createCommunity(unconfirmed, { name: "Claim", slug: slug("claim") }),
    ).rejects.toBeInstanceOf(CommunityCreationRestrictedError);
  });
});

describe("about page data", () => {
  it("reads the owner, admin count, avatars, and gallery through tenant scoped queries", async () => {
    const owner = await newUser();
    const created = await service.createCommunity(owner, {
      name: "About",
      slug: slug("about"),
      privacy: "private",
    });
    const joiner = await newUser();
    await adminDb.execute(
      sql`insert into memberships (id, community_id, user_id, role, status, joined_at)
          values (${newId()}, ${created.community.id}, ${joiner.userId}, 'admin', 'active', now())`,
    );
    await adminDb.execute(
      sql`insert into community_gallery_items (id, community_id, kind, embed_url, position)
          values (${newId()}, ${created.community.id}, 'video_embed', 'https://www.loom.com/embed/0123456789abcdef', 0)`,
    );

    const about = await service.getAbout({ kind: "guest" }, created.community.id);

    expect(about.owner?.name).toBe("Person");
    expect(about.adminCount).toBe(2);
    expect(about.avatars).toHaveLength(2);
    expect(about.gallery).toMatchObject([{ kind: "video_embed", provider: "loom", position: 0 }]);
    const other = await service.getAbout({ kind: "guest" }, communityA.id);
    expect(other.gallery).toEqual([]);
  });

  it("gives visitors of a private community the what you get list, host, and FAQ", async () => {
    const owner = await newUser();
    const created = await service.createCommunity(owner, {
      name: "Selling",
      slug: slug("selling"),
      privacy: "private",
    });
    await adminDb.execute(
      sql`update communities
          set what_you_get = '["Weekly live calls"]'::jsonb,
              host_credential = 'Ran three communities',
              faq = '[{"q":"Can I cancel?","a":"Yes."}]'::jsonb
          where id = ${created.community.id}`,
    );

    const about = await service.getAbout({ kind: "guest" }, created.community.id);

    expect(about.content).toEqual({
      whatYouGet: ["Weekly live calls"],
      host: { bio: null, credential: "Ran three communities" },
      faq: [{ q: "Can I cancel?", a: "Yes." }],
    });
  });
});
