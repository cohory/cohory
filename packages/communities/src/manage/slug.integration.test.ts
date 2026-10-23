import { AgentNotAllowedError, ForbiddenError, type Actor } from "@cohory/authz";
import { newId, setRlsValue } from "@cohory/db";
import { communitySlugHistory } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityNotFoundError,
  CommunityValidationError,
  SlugChangeTooSoonError,
  SlugReservedError,
  SlugTakenError,
} from "../errors";
import { createPostgresCommunitiesRepository } from "../postgres-repository";
import { createCommunitiesService, type CommunitiesService } from "../service";
import {
  insertCast,
  insertUser,
  openManageHarness,
  openPool,
  manageProbeRole,
  type Cast,
  type ManageHarness,
  type UserActor,
} from "../test/manage-fixtures";

const dayMs = 24 * 60 * 60 * 1000;
let clock = new Date("2026-10-21T09:00:00.000Z");
let h: ManageHarness;
let communities: CommunitiesService;

function freshSlug(prefix: string): string {
  return `${prefix}-${newId().slice(-12)}`;
}

function viaToken(actor: UserActor, type: "user" | "agent", communityId: string): Actor {
  return {
    ...actor,
    credential: {
      type,
      tokenId: newId(),
      agentId: type === "agent" ? newId() : null,
      communityId,
      scopes: ["settings:read"],
      via: "api",
    },
  };
}

async function slugAudit(communityId: string) {
  const result = await h.admin.execute<{ action: string; metadata: Record<string, string> }>(
    sql`select action, metadata from audit_log where community_id = ${communityId} and action = 'community.slug_changed' order by created_at, id`,
  );
  return result.rows;
}

beforeAll(async () => {
  h = await openManageHarness({ now: () => clock });
  communities = createCommunitiesService(createPostgresCommunitiesRepository(h.app));
});

afterAll(async () => {
  await h.close();
});

describe("changeSlug", () => {
  let cast: Cast;
  let first: string;

  beforeAll(async () => {
    cast = await insertCast(h.admin, "public");
    first = cast.slug;
  });

  it("lets the owner change the URL, keeps the old one as a redirect, and audits it", async () => {
    const next = freshSlug("renamed");
    const status = await h.service.changeSlug(cast.owner, cast.communityId, { slug: next });

    expect(status).toEqual({
      slug: next,
      canChange: false,
      changedAt: clock,
      nextChangeAt: new Date(clock.getTime() + 30 * dayMs),
    });
    expect((await communities.getCommunityBySlug(cast.owner, next)).id).toBe(cast.communityId);
    await expect(communities.getCommunityBySlug(cast.owner, first)).rejects.toThrow(
      CommunityNotFoundError,
    );
    expect(await communities.findMovedSlug(first)).toBe(next);
    expect(await slugAudit(cast.communityId)).toEqual([
      { action: "community.slug_changed", metadata: { from: first, to: next } },
    ]);
  });

  it("refuses a second change within 30 days and names the date it becomes possible", async () => {
    const status = await h.service.getSlugStatus(cast.owner, cast.communityId);
    clock = new Date(clock.getTime() + 29 * dayMs);
    const attempt = h.service.changeSlug(cast.owner, cast.communityId, {
      slug: freshSlug("too-soon"),
    });

    await expect(attempt).rejects.toThrow(SlugChangeTooSoonError);
    await expect(attempt).rejects.toMatchObject({
      code: "slug_change_too_soon",
      availableAt: status.nextChangeAt,
    });
  });

  it("allows the next change after 30 days and points every old URL at the newest", async () => {
    const middle = (await h.service.getSlugStatus(cast.owner, cast.communityId)).slug;
    clock = new Date(clock.getTime() + 1 * dayMs);
    const latest = freshSlug("latest");
    await h.service.changeSlug(cast.owner, cast.communityId, { slug: latest });

    expect(await communities.findMovedSlug(first)).toBe(latest);
    expect(await communities.findMovedSlug(middle)).toBe(latest);
    expect(await communities.findMovedSlug(latest)).toBeNull();
  });

  it("treats the current URL as no change and does not start a new 30 days", async () => {
    const before = await h.service.getSlugStatus(cast.owner, cast.communityId);
    const after = await h.service.changeSlug(cast.owner, cast.communityId, {
      slug: before.slug,
    });

    expect(after).toEqual(before);
    expect(await slugAudit(cast.communityId)).toHaveLength(2);
  });

  it("lets the owner return to one of the community's own old URLs", async () => {
    clock = new Date(clock.getTime() + 31 * dayMs);
    const current = (await h.service.getSlugStatus(cast.owner, cast.communityId)).slug;
    await h.service.changeSlug(cast.owner, cast.communityId, { slug: first });

    expect((await communities.getCommunityBySlug(cast.owner, first)).id).toBe(cast.communityId);
    expect(await communities.findMovedSlug(first)).toBeNull();
    expect(await communities.findMovedSlug(current)).toBe(first);
  });
});

describe("slug uniqueness", () => {
  let mover: Cast;
  let other: Cast;
  let formerSlug: string;
  let currentSlug: string;

  beforeAll(async () => {
    clock = new Date(clock.getTime() + 60 * dayMs);
    mover = await insertCast(h.admin);
    other = await insertCast(h.admin);
    formerSlug = mover.slug;
    currentSlug = freshSlug("moved");
    await h.service.changeSlug(mover.owner, mover.communityId, { slug: currentSlug });
  });

  it("refuses the current URL of another community", async () => {
    await expect(
      h.service.changeSlug(other.owner, other.communityId, { slug: currentSlug }),
    ).rejects.toThrow(SlugTakenError);
  });

  it("refuses a URL another community used before", async () => {
    await expect(
      h.service.changeSlug(other.owner, other.communityId, { slug: formerSlug }),
    ).rejects.toThrow(SlugTakenError);
  });

  it("refuses a new community on a URL another community used before", async () => {
    const creator = await insertUser(h.admin, "Creator");
    await expect(
      communities.createCommunity(creator, { name: "Taken", slug: formerSlug }),
    ).rejects.toThrow(SlugTakenError);
  });

  it("keeps the refused community on its own URL", async () => {
    const status = await h.service.getSlugStatus(other.owner, other.communityId);
    expect(status).toMatchObject({ slug: other.slug, canChange: true, changedAt: null });
  });

  it.each(["manage", "api", "settings"])("refuses the reserved URL %s", async (slug) => {
    await expect(h.service.changeSlug(other.owner, other.communityId, { slug })).rejects.toThrow(
      SlugReservedError,
    );
  });

  it.each(["No Caps", "ab", "double--hyphen"])("refuses the invalid URL %s", async (slug) => {
    await expect(h.service.changeSlug(other.owner, other.communityId, { slug })).rejects.toThrow(
      CommunityValidationError,
    );
  });
});

describe("who can change the URL", () => {
  let cast: Cast;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
  });

  it.each(["admin", "moderator", "member"] as const)("denies the %s", async (role) => {
    await expect(
      h.service.changeSlug(cast[role], cast.communityId, { slug: freshSlug(role) }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("shows admins the URL read only", async () => {
    expect(await h.service.getSlugStatus(cast.admin, cast.communityId)).toMatchObject({
      slug: cast.slug,
      canChange: false,
    });
  });

  it("refuses the owner's agent without creating an approval", async () => {
    await expect(
      h.service.changeSlug(viaToken(cast.owner, "agent", cast.communityId), cast.communityId, {
        slug: freshSlug("agent"),
      }),
    ).rejects.toThrow(AgentNotAllowedError);
  });

  it("refuses the owner's personal API token", async () => {
    await expect(
      h.service.changeSlug(viaToken(cast.owner, "user", cast.communityId), cast.communityId, {
        slug: freshSlug("token"),
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("hides the community from the owner of another community", async () => {
    const elsewhere = await insertCast(h.admin);
    await expect(
      h.service.changeSlug(elsewhere.owner, cast.communityId, { slug: freshSlug("cross") }),
    ).rejects.toThrow(CommunityNotFoundError);
    expect(await h.service.getSlugStatus(cast.owner, cast.communityId)).toMatchObject({
      slug: cast.slug,
      changedAt: null,
    });
  });
});

describe("community_slug_history row level security", () => {
  let cast: Cast;
  let other: Cast;
  let former: string;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
    other = await insertCast(h.admin);
    former = cast.slug;
    await h.service.changeSlug(cast.owner, cast.communityId, { slug: freshSlug("rls") });
  });

  it("forces row level security on the table", async () => {
    const result = await h.admin.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'community_slug_history'`,
    );
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("lets anyone read old URLs so they can redirect", async () => {
    const rows = await h.app
      .select()
      .from(communitySlugHistory)
      .where(eq(communitySlugHistory.slug, former));
    expect(rows.map((row) => row.communityId)).toEqual([cast.communityId]);
  });

  it("refuses a row for a community other than app.community_id", async () => {
    await expect(
      h.app.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", other.communityId);
        await tx
          .insert(communitySlugHistory)
          .values({ slug: freshSlug("forged"), communityId: cast.communityId });
      }),
    ).rejects.toThrow();
  });

  it("never updates or deletes a held URL", async () => {
    const probe = openPool(manageProbeRole);
    try {
      await probe.db.transaction(async (tx) => {
        await setRlsValue(tx, "community_id", cast.communityId);
        const updated = await tx
          .update(communitySlugHistory)
          .set({ communityId: other.communityId })
          .where(eq(communitySlugHistory.slug, former))
          .returning();
        const deleted = await tx
          .delete(communitySlugHistory)
          .where(eq(communitySlugHistory.slug, former))
          .returning();
        expect(updated).toEqual([]);
        expect(deleted).toEqual([]);
      });
    } finally {
      await probe.close();
    }
    expect(await communities.findMovedSlug(former)).not.toBeNull();
  });
});
