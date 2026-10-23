import { ForbiddenError } from "@cohory/authz";
import { communities } from "@cohory/db/schema";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { communityKey, StorageError } from "@cohory/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityNotFoundError,
  CommunityValidationError,
  GalleryItemNotFoundError,
} from "../errors";
import { isGalleryKey } from "../gallery";
import {
  auditActions,
  cleanedImage,
  fakeImageProcessor,
  insertCast,
  openManageHarness,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;
let limited: ManageHarness;
let sized: ManageHarness;
let limitedSized: ManageHarness;
const thumbnailLookups: string[] = [];
const vimeoThumbnail = "https://i.vimeocdn.com/video/452001751-d_640";

beforeAll(async () => {
  h = await openManageHarness({
    videoThumbnail: async (embedUrl) => {
      thumbnailLookups.push(embedUrl);
      return embedUrl.startsWith("https://player.vimeo.com/") ? vimeoThumbnail : null;
    },
  });
  limited = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_STORAGE_BYTES: "1000" }),
  });
  sized = await openManageHarness({ processImage: fakeImageProcessor() });
  limitedSized = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_STORAGE_BYTES: "1000" }),
    processImage: fakeImageProcessor((width) => width / 2),
  });
});

afterAll(async () => {
  await h.close();
  await limited.close();
  await sized.close();
  await limitedSized.close();
});

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
const upload = { bytes: png, declaredType: "image/png" };
const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

async function addVideos(cast: Cast, count: number) {
  for (let index = 0; index < count; index += 1) {
    await h.service.addGalleryVideo(cast.owner, cast.communityId, { url: youtube });
  }
}

describe("gallery", () => {
  it("adds an image under the community gallery folder and lists it for anyone", async () => {
    const cast = await insertCast(h.admin);

    const gallery = await h.service.addGalleryImage(cast.admin, cast.communityId, upload, " Hero ");

    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({ kind: "image", altText: "Hero", position: 0 });
    const [key] = [...h.storage.objects.keys()].filter((k) => k.includes(cast.communityId));
    expect(key && isGalleryKey(key)).toBe(true);
    expect(await h.service.listGallery(cast.communityId)).toEqual(gallery);
    expect(await auditActions(h.admin, cast.communityId)).toContain("appearance.updated");
  });

  it("normalizes YouTube, Vimeo, and Loom links to their embed URLs", async () => {
    const cast = await insertCast(h.admin);

    await h.service.addGalleryVideo(cast.owner, cast.communityId, { url: youtube });
    await h.service.addGalleryVideo(cast.owner, cast.communityId, {
      url: "https://vimeo.com/76979871",
    });
    const gallery = await h.service.addGalleryVideo(cast.owner, cast.communityId, {
      url: "https://www.loom.com/share/0123456789abcdef",
      altText: "Walkthrough",
    });

    expect(gallery.map((item) => (item.kind === "video_embed" ? item.provider : null))).toEqual([
      "youtube",
      "vimeo",
      "loom",
    ]);
    expect(gallery.map((item) => item.url)).toEqual([
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://player.vimeo.com/video/76979871",
      "https://www.loom.com/embed/0123456789abcdef",
    ]);
    expect(gallery.map((item) => (item.kind === "video_embed" ? item.thumbnailUrl : null))).toEqual(
      ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", vimeoThumbnail, null],
    );
  });

  it("refuses video links outside the embed allowlist", async () => {
    const cast = await insertCast(h.admin);

    for (const url of [
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://fast.wistia.net/embed/iframe/abcdef1234",
      "javascript:alert(1)",
    ]) {
      await expect(
        h.service.addGalleryVideo(cast.owner, cast.communityId, { url }),
      ).rejects.toBeInstanceOf(CommunityValidationError);
    }
    expect(await h.service.listGallery(cast.communityId)).toEqual([]);
  });

  it("holds at most 10 items and deletes the stored file of a refused image", async () => {
    const cast = await insertCast(h.admin);
    await addVideos(cast, 10);

    await expect(
      h.service.addGalleryVideo(cast.owner, cast.communityId, { url: youtube }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      h.service.addGalleryImage(cast.owner, cast.communityId, upload),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    expect([...h.storage.objects.keys()].some((k) => k.includes(cast.communityId))).toBe(false);
    expect(await h.service.listGallery(cast.communityId)).toHaveLength(10);
  });

  it("reorders in one call and refuses a list that is not every item exactly once", async () => {
    const cast = await insertCast(h.admin);
    await h.service.addGalleryImage(cast.owner, cast.communityId, upload, "First");
    await h.service.addGalleryVideo(cast.owner, cast.communityId, { url: youtube });
    const added = await h.service.addGalleryImage(cast.owner, cast.communityId, upload, "Third");
    const [a, b, c] = added.map((item) => item.id);
    if (!a || !b || !c) throw new Error("expected three items");

    const reordered = await h.service.reorderGallery(cast.admin, cast.communityId, {
      itemIds: [c, a, b],
    });

    expect(reordered.map((item) => [item.id, item.position])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
    ]);
    for (const itemIds of [
      [c, a],
      [c, a, a],
      [c, a, b, b],
      [c, a, "not-an-item"],
    ]) {
      await expect(
        h.service.reorderGallery(cast.owner, cast.communityId, { itemIds }),
      ).rejects.toBeInstanceOf(CommunityValidationError);
    }
  });

  it("updates alt text and removes an item, deleting its file and closing the gap", async () => {
    const cast = await insertCast(h.admin);
    const first = await h.service.addGalleryImage(cast.owner, cast.communityId, upload);
    await h.service.addGalleryVideo(cast.owner, cast.communityId, { url: youtube });
    const imageId = first[0]?.id ?? "";
    const key = [...h.storage.objects.keys()].find((k) => k.includes(cast.communityId)) ?? "";

    const updated = await h.service.updateGalleryItem(cast.owner, cast.communityId, imageId, {
      altText: "Members at the meetup",
    });
    expect(updated[0]?.altText).toBe("Members at the meetup");

    const remaining = await h.service.removeGalleryItem(cast.owner, cast.communityId, imageId);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ kind: "video_embed", position: 0 });
    expect(h.storage.deleted).toContain(key);
    await expect(
      h.service.removeGalleryItem(cast.owner, cast.communityId, imageId),
    ).rejects.toBeInstanceOf(GalleryItemNotFoundError);
  });

  it("stores the cleaned original and width variants of an uploaded image and deletes them with the item", async () => {
    const cast = await insertCast(sized.admin);

    const [item] = await sized.service.addGalleryImage(cast.owner, cast.communityId, upload);
    const stored = [...sized.storage.objects.keys()].filter((k) => k.includes(cast.communityId));

    expect(item).toMatchObject({ kind: "image", url: expect.stringMatching(/\.sized\.png$/) });
    expect(stored.map((k) => k.slice(k.lastIndexOf("."))).sort()).toEqual([
      ".png",
      ".webp",
      ".webp",
      ".webp",
      ".webp",
    ]);
    expect(stored.every((k) => isGalleryKey(k))).toBe(true);
    const original = stored.find((k) => k.endsWith(".sized.png")) ?? "";
    expect(sized.storage.objects.get(original)?.body).toEqual(cleanedImage);

    await sized.service.removeGalleryItem(cast.owner, cast.communityId, item?.id ?? "");

    expect(sized.storage.deleted).toEqual(expect.arrayContaining(stored));
  });

  it("applies the cover image type and size checks", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.addGalleryImage(cast.owner, cast.communityId, {
        bytes: new TextEncoder().encode("<svg></svg>"),
        declaredType: "image/svg+xml",
      }),
    ).rejects.toBeInstanceOf(StorageError);
    await expect(
      h.service.addGalleryImage(cast.owner, cast.communityId, {
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it.each(["moderator", "member", "outsider"] as const)(
    "refuses gallery changes by a %s",
    async (who) => {
      const cast = await insertCast(h.admin, "public");
      const existing = await h.service.addGalleryVideo(cast.owner, cast.communityId, {
        url: youtube,
      });
      const itemId = existing[0]?.id ?? "";
      const actor = cast[who];

      const lookups = thumbnailLookups.length;
      await expect(
        h.service.addGalleryVideo(actor, cast.communityId, { url: youtube }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(thumbnailLookups).toHaveLength(lookups);
      await expect(
        h.service.addGalleryImage(actor, cast.communityId, upload),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        h.service.reorderGallery(actor, cast.communityId, { itemIds: [itemId] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        h.service.updateGalleryItem(actor, cast.communityId, itemId, { altText: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        h.service.removeGalleryItem(actor, cast.communityId, itemId),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await h.service.listGallery(cast.communityId)).toHaveLength(1);
    },
  );

  it("refuses guests and cannot reach another community's items", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    const theirs = await h.service.addGalleryVideo(other.owner, other.communityId, {
      url: youtube,
    });
    const theirId = theirs[0]?.id ?? "";

    await expect(
      h.service.addGalleryVideo({ kind: "guest" }, cast.communityId, { url: youtube }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      h.service.removeGalleryItem(cast.owner, cast.communityId, theirId),
    ).rejects.toBeInstanceOf(GalleryItemNotFoundError);
    await expect(
      h.service.updateGalleryItem(cast.owner, cast.communityId, theirId, { altText: "mine" }),
    ).rejects.toBeInstanceOf(GalleryItemNotFoundError);
    await expect(
      h.service.reorderGallery(cast.owner, cast.communityId, { itemIds: [theirId] }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      h.service.addGalleryVideo(cast.owner, other.communityId, { url: youtube }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    expect(await h.service.listGallery(other.communityId)).toHaveLength(1);
  });

  it("deletes the gallery files when the community is deleted", async () => {
    const cast = await insertCast(h.admin);
    await h.service.addGalleryImage(cast.owner, cast.communityId, upload);
    const key = [...h.storage.objects.keys()].find((k) => k.includes(cast.communityId)) ?? "";
    await h.service.archiveCommunity(cast.owner, cast.communityId);

    await h.service.deleteCommunity(cast.owner, cast.communityId);

    expect(h.storage.deleted).toContain(key);
    expect(h.storage.objects.has(key)).toBe(false);
  });
});

describe("gallery storage", () => {
  it("counts gallery images against the storage limit", async () => {
    const cast = await insertCast(limited.admin);
    limited.storage.objects.set(communityKey(cast.communityId, "posts", "big.png"), {
      key: communityKey(cast.communityId, "posts", "big.png"),
      body: new Uint8Array(990),
      contentType: "image/png",
    });

    const error = await limited.service
      .addGalleryImage(cast.owner, cast.communityId, upload)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "storage", limit: 1000, used: 990 });
  });

  it("counts the resized copies against the storage limit and stores nothing when they do not fit", async () => {
    const cast = await insertCast(limitedSized.admin);

    const error = await limitedSized.service
      .addGalleryImage(cast.owner, cast.communityId, upload)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "storage", limit: 1000, used: 0 });
    expect([...limitedSized.storage.objects.keys()].some((k) => k.includes(cast.communityId))).toBe(
      false,
    );
  });

  it("includes stored gallery images in the usage total", async () => {
    const cast = await insertCast(limited.admin);
    await limited.service.addGalleryImage(cast.owner, cast.communityId, upload);

    const usage = await limited.service.getUsage(cast.admin, cast.communityId);

    expect(usage.storageBytes.used).toBe(png.byteLength);
  });
});

describe("detailed description", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "mention", attrs: { id: "0192f5f0-0000-7000-8000-000000000001", label: "Ann" } },
        ],
      },
      { type: "embed", attrs: { url: youtube } },
    ],
  };

  it("stores a validated document, turns mentions into text, and clears it with null", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.updateAppearance(cast.admin, cast.communityId, {
      detailedDescription: doc,
    });

    expect(view.detailedDescription?.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "@Ann" },
      ],
    });
    const cleared = await h.service.updateAppearance(cast.owner, cast.communityId, {
      detailedDescription: null,
    });
    expect(cleared.detailedDescription).toBeNull();
    const [row] = await h.admin
      .select({ value: communities.detailedDescription })
      .from(communities)
      .where(eq(communities.id, cast.communityId));
    expect(row?.value).toBeNull();
  });

  it("refuses scripts, images, and unknown attributes", async () => {
    const cast = await insertCast(h.admin);

    for (const detailedDescription of [
      "<script>alert(1)</script>",
      { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "x" } }] },
      {
        type: "doc",
        content: [{ type: "image", attrs: { key: `communities/${cast.communityId}/posts/a.png` } }],
      },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
    ]) {
      await expect(
        h.service.updateAppearance(cast.owner, cast.communityId, { detailedDescription }),
      ).rejects.toBeInstanceOf(CommunityValidationError);
    }
  });

  it("is refused for a moderator", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.updateAppearance(cast.moderator, cast.communityId, { detailedDescription: doc }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
