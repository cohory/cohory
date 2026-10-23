import { getCommunityBySlug } from "@cohory/db";
import { communities, communityGalleryItems } from "@cohory/db/schema";
import { devPaidSeed, devSeed, seedDevData } from "@cohory/db/seed";
import { sniffImageType } from "@cohory/storage";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { seedDevCommunity } from "./seed";
import { createMemoryStorage, openManageHarness, openPool } from "./test/manage-fixtures";

const admin = openPool();

afterAll(async () => {
  await admin.close();
});

const seededSlugs = [devSeed.communitySlug, devPaidSeed.communitySlug];

async function clearBranding(): Promise<void> {
  const rows = await admin.db
    .select({ id: communities.id })
    .from(communities)
    .where(inArray(communities.slug, seededSlugs));
  await admin.db
    .update(communities)
    .set({ appearance: {}, detailedDescription: null, joinQuestions: null })
    .where(inArray(communities.slug, seededSlugs));
  await admin.db.delete(communityGalleryItems).where(
    inArray(
      communityGalleryItems.communityId,
      rows.map((row) => row.id),
    ),
  );
}

describe("community dev seed", () => {
  it("brands Cohory Creators and Cohory Pro with About text, logo, cover, gallery, and join questions, once", async () => {
    const storage = createMemoryStorage();
    await seedDevData(admin.db);
    await clearBranding();

    const first = await seedDevCommunity(admin.db, storage);
    const again = await seedDevCommunity(admin.db, storage);

    expect(first).toEqual({
      creators: {
        aboutWritten: true,
        logoUploaded: true,
        coverUploaded: true,
        galleryAdded: 4,
        joinQuestionsWritten: true,
      },
      pro: {
        aboutWritten: true,
        logoUploaded: true,
        coverUploaded: true,
        galleryAdded: 0,
        joinQuestionsWritten: false,
      },
    });
    const unchanged = {
      aboutWritten: false,
      logoUploaded: false,
      coverUploaded: false,
      galleryAdded: 0,
      joinQuestionsWritten: false,
    };
    expect(again).toEqual({ creators: unchanged, pro: unchanged });

    const creators = await getCommunityBySlug(admin.db, devSeed.communitySlug);
    const logoKey = creators?.appearance.logoKey ?? "";
    expect(logoKey).toMatch(new RegExp(`^communities/${creators?.id}/branding/logo-.+\\.png$`));
    expect(creators?.appearance.coverKey).toMatch(
      new RegExp(`^communities/${creators?.id}/branding/cover-`),
    );
    const stored = storage.objects.get(logoKey);
    expect(sniffImageType(stored?.body ?? new Uint8Array())).toBe("image/png");
    expect(creators?.detailedDescription).toMatchObject({ type: "doc" });
    expect(creators?.joinQuestions).toEqual([
      { text: "What community are you building, and who is it for?", required: true },
      expect.objectContaining({ required: true }),
      expect.objectContaining({ required: false }),
    ]);
    const gallery = await admin.db
      .select({ altText: communityGalleryItems.altText })
      .from(communityGalleryItems)
      .where(eq(communityGalleryItems.communityId, creators?.id ?? ""));
    expect(gallery).toHaveLength(4);
    expect(gallery.every((item) => (item.altText ?? "").length > 0)).toBe(true);

    const pro = await getCommunityBySlug(admin.db, devPaidSeed.communitySlug);
    expect(pro?.appearance.logoKey).toMatch(new RegExp(`^communities/${pro?.id}/branding/logo-`));
    expect(pro?.appearance.coverKey).toMatch(new RegExp(`^communities/${pro?.id}/branding/cover-`));
    expect(pro?.detailedDescription).toMatchObject({ type: "doc" });
  });

  it("seeds invite links that open the Cohory Creators and Cohory Pro join pages", async () => {
    const harness = await openManageHarness();
    try {
      await seedDevData(harness.admin);

      expect(await harness.service.previewInvite(devSeed.inviteToken)).toEqual({
        community: { slug: devSeed.communitySlug, name: devSeed.communityName },
        status: "active",
      });
      expect(await harness.service.previewInvite(devPaidSeed.inviteToken)).toEqual({
        community: { slug: devPaidSeed.communitySlug, name: devPaidSeed.communityName },
        status: "active",
      });
    } finally {
      await harness.close();
    }
  });
});
