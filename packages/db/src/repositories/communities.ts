import { and, eq, isNull, ne } from "drizzle-orm";

import type { Database } from "../client";
import { newId } from "../ids";
import {
  categories,
  communities,
  communitySlugHistory,
  memberships,
  type CategoryColor,
  type CommunityPrivacy,
  type JoinMode,
} from "../schema";
import type { CommunitySlug } from "../slug";
import {
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type CommunityId,
} from "../tenancy/scope";
import type { Membership } from "./memberships";
import { isUniqueViolation } from "./unique-violation";

export type Community = Omit<typeof communities.$inferSelect, "id"> & { id: CommunityId };

export interface NewCommunity {
  slug: CommunitySlug;
  name: string;
  description?: string | null;
  privacy?: CommunityPrivacy;
  joinMode?: JoinMode;
}

export interface NewOwnedCommunity extends NewCommunity {
  ownerUserId: string;
}

export type CreateOwnedCommunityResult =
  { kind: "created"; community: Community; membership: Membership } | { kind: "slug_taken" };

const slugConstraint = "communities_slug_unique";

export const defaultCategories: readonly {
  readonly name: string;
  readonly slug: string;
  readonly color: CategoryColor;
  readonly staffOnly: boolean;
}[] = [
  { name: "General", slug: "general", color: "neutral", staffOnly: false },
  { name: "Introductions", slug: "introductions", color: "accent", staffOnly: false },
  { name: "Announcements", slug: "announcements", color: "warning", staffOnly: true },
];

function toCommunity(row: typeof communities.$inferSelect): Community {
  return { ...row, id: parseCommunityId(row.id) };
}

export async function createCommunity(db: Database, input: NewCommunity): Promise<Community> {
  const id = parseCommunityId(newId());
  return runInCommunity(withCommunity(db, id), async ({ tx }) => {
    const [row] = await tx
      .insert(communities)
      .values({ ...input, id })
      .returning();
    if (!row) {
      throw new Error("community insert returned no row");
    }
    return toCommunity(row);
  });
}

export async function createCommunityWithOwner(
  db: Database,
  { ownerUserId, ...input }: NewOwnedCommunity,
): Promise<CreateOwnedCommunityResult> {
  const id = parseCommunityId(newId());
  try {
    return await runInCommunity(withCommunity(db, id), async ({ tx, values }) => {
      const [community] = await tx
        .insert(communities)
        .values({ ...input, id })
        .returning();
      const [membership] = await tx
        .insert(memberships)
        .values(
          values({ userId: ownerUserId, role: "owner", status: "active", joinedAt: new Date() }),
        )
        .returning();
      if (!community || !membership) {
        throw new Error("community insert returned no row");
      }
      await tx
        .insert(categories)
        .values(
          defaultCategories.map((category, position) =>
            values({ ...category, id: newId(), position }),
          ),
        );
      return { kind: "created", community: toCommunity(community), membership };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error, slugConstraint)) {
      return { kind: "slug_taken" };
    }
    throw error;
  }
}

export async function getCommunityBySlug(
  db: Database,
  slug: CommunitySlug,
): Promise<Community | null> {
  const [row] = await db
    .select()
    .from(communities)
    .where(and(eq(communities.slug, slug), isNull(communities.deletedAt)))
    .limit(1);
  return row ? toCommunity(row) : null;
}

export async function findMovedCommunitySlug(
  db: Database,
  formerSlug: CommunitySlug,
): Promise<string | null> {
  const [row] = await db
    .select({ slug: communities.slug })
    .from(communitySlugHistory)
    .innerJoin(communities, eq(communities.id, communitySlugHistory.communityId))
    .where(
      and(
        eq(communitySlugHistory.slug, formerSlug),
        ne(communities.slug, formerSlug),
        isNull(communities.deletedAt),
      ),
    )
    .limit(1);
  return row?.slug ?? null;
}

export async function getCommunityById(db: Database, id: CommunityId): Promise<Community | null> {
  const [row] = await db
    .select()
    .from(communities)
    .where(and(eq(communities.id, id), isNull(communities.deletedAt)))
    .limit(1);
  return row ? toCommunity(row) : null;
}
