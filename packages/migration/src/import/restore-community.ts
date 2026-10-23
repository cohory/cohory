import {
  deriveAppearanceTokens,
  maxGalleryItems,
  parseDetailedDescription,
} from "@cohory/communities";
import { videoProviderOfEmbedUrl } from "@cohory/content";
import {
  auditLog,
  communities,
  communityGalleryItems,
  type CommunityAppearance,
} from "@cohory/db/schema";
import { eq } from "drizzle-orm";

import { date, type RestoreContext } from "./restore-context";

export async function restoreCommunity(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, scope, progress, rewriteKey } = ctx;
  const [community] = records.community;
  if (community && !map.has("community", community.id)) {
    await scope(async (tx) => {
      const appearance: CommunityAppearance = {
        ...community.appearance,
        logoKey: rewriteKey(community.appearance.logoKey),
        coverKey: rewriteKey(community.appearance.coverKey),
      };
      let detailedDescription = null;
      if (community.detailedDescription) {
        try {
          detailedDescription = parseDetailedDescription(community.detailedDescription);
        } catch {
          skips.add("community", community.id, "The detailed description is not valid content.");
        }
      }
      await tx
        .update(communities)
        .set({
          name: community.name,
          description: community.description,
          privacy: community.privacy,
          joinMode: community.joinMode,
          joinQuestions: community.joinQuestions,
          appearance,
          appearanceTokens: deriveAppearanceTokens(appearance),
          gamificationEnabled: community.gamificationEnabled,
          reviewsEnabled: community.reviewsEnabled ?? false,
          pointsForLessons: community.pointsForLessons ?? false,
          pointsForEvents: community.pointsForEvents ?? false,
          levelNames: [...community.levelNames],
          detailedDescription,
        })
        .where(eq(communities.id, target));
      const entry = map.assign("community", community.id, target);
      await map.persist(tx, [entry]);
    });
  }
  await progress("community", records.community.length);
}

export async function restoreGallery(ctx: RestoreContext): Promise<void> {
  const { records, target, skips, phase, rewriteKey } = ctx;
  let galleryCount = 0;
  await phase(
    "community_gallery",
    [...records.community_gallery].sort((a, b) => a.position - b.position),
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const storageKey = row.kind === "image" ? rewriteKey(row.storageKey) : null;
        const embedUrl =
          row.kind === "video_embed" && row.embedUrl && videoProviderOfEmbedUrl(row.embedUrl)
            ? row.embedUrl
            : null;
        const reason =
          galleryCount >= maxGalleryItems
            ? `The gallery already holds ${maxGalleryItems} items.`
            : row.kind === "image" && !storageKey
              ? "The image key is not allowed."
              : row.kind === "video_embed" && !embedUrl
                ? "The video link is not an allowed embed."
                : null;
        if (reason) {
          skips.add("community_gallery", row.id, reason);
          skipped.add(row.id);
          continue;
        }
        await tx.insert(communityGalleryItems).values({
          id,
          communityId: target,
          kind: row.kind,
          storageKey,
          embedUrl,
          position: galleryCount,
          altText: row.altText,
          createdAt: date(row.createdAt),
        });
        galleryCount += 1;
      }
      return skipped;
    },
  );
}

export async function restoreAuditLog(ctx: RestoreContext): Promise<void> {
  const { records, target, phase, user } = ctx;
  await phase(
    "audit_log",
    records.audit_log,
    (row) => row.id,
    async (tx, items) => {
      if (items.length > 0) {
        await tx.insert(auditLog).values(
          items.map(({ row, id }) => ({
            id,
            communityId: target,
            actorId: user(row.actorId) ?? null,
            action: row.action,
            target: row.target,
            metadata: row.metadata,
            createdAt: date(row.createdAt),
          })),
        );
      }
      return new Set<string>();
    },
  );
}
