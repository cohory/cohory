import { assertCan, type Actor } from "@cohory/authz";
import { normalizeVideoLink } from "@cohory/content";
import { communityIdSchema, newId } from "@cohory/db";
import { maxGalleryItems } from "@cohory/db/schema";
import {
  communityKey,
  parseStorageKey,
  prepareImage,
  storePreparedImage,
  storedImageKeys,
  validateImage,
  type ImageUpload,
  type StorageKey,
} from "@cohory/storage";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

import { assertCommunityWritable } from "../archive";
import {
  CommunityNotFoundError,
  CommunityValidationError,
  GalleryItemNotFoundError,
} from "../errors";
import { toGalleryView, type GalleryItemView } from "../gallery";
import { assertStorageRoom, brandingMaxBytes } from "./appearance";
import { inManagedCommunity, parseInput, type Managed, type Runtime } from "./context";
import {
  addGalleryVideoInputSchema,
  galleryAltTextSchema,
  reorderGalleryInputSchema,
  updateGalleryItemInputSchema,
  type AddGalleryVideoInput,
  type ReorderGalleryInput,
  type UpdateGalleryItemInput,
} from "./schemas";

const itemIdSchema = z.uuid();

export const galleryFullMessage = `The gallery can hold up to ${maxGalleryItems} items. Remove one to add another.`;

function assertRoom(count: number): void {
  if (count >= maxGalleryItems) {
    throw new CommunityValidationError([{ path: "gallery", message: galleryFullMessage }]);
  }
}

function parseItemId(itemId: string): string {
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) {
    throw new GalleryItemNotFoundError();
  }
  return parsed.data;
}

export function galleryOperations(runtime: Runtime) {
  function inGallery<T>(
    actor: Actor,
    communityId: string,
    fn: (managed: Managed) => Promise<T>,
  ): Promise<T> {
    return inManagedCommunity(runtime, actor, communityId, async (managed) => {
      assertCan(actor, "update", "appearance", managed.context);
      assertCommunityWritable(managed.community);
      await managed.store.enableManagement();
      await managed.store.lockCommunity();
      return fn(managed);
    });
  }

  async function settle(managed: Managed, change: string, itemId: string | null) {
    await managed.store.appendAudit({
      actorId: managed.user.userId,
      action: "appearance.updated",
      target: managed.community.id,
      metadata: { fields: ["gallery"], change, ...(itemId ? { itemId } : {}) },
    });
    return toGalleryView(await managed.store.listGallery(), runtime.brandingUrl);
  }

  async function deleteFile(key: string | StorageKey): Promise<void> {
    try {
      for (const stored of storedImageKeys(parseStorageKey(key))) {
        await runtime.storage.delete(stored);
      }
    } catch (error: unknown) {
      logger.warn(
        { name: error instanceof Error ? error.name : "unknown" },
        "gallery file was not deleted",
      );
    }
  }

  function nextPosition(items: readonly { position: number }[]): number {
    const last = items.at(-1);
    return last ? last.position + 1 : 0;
  }

  return {
    async listGallery(communityId: string): Promise<GalleryItemView[]> {
      const parsedId = communityIdSchema.safeParse(communityId);
      if (!parsedId.success) {
        throw new CommunityNotFoundError();
      }
      return runtime.repo.inCommunity(parsedId.data, {}, async (store) => {
        const community = await store.findCommunity();
        if (!community || community.deletedAt) {
          throw new CommunityNotFoundError();
        }
        return toGalleryView(await store.listGallery(), runtime.brandingUrl);
      });
    },

    async addGalleryImage(
      actor: Actor,
      communityId: string,
      upload: ImageUpload,
      altText?: string | null,
    ): Promise<GalleryItemView[]> {
      const image = validateImage(upload, brandingMaxBytes.cover);
      const alt = parseInput(galleryAltTextSchema, altText ?? null);
      const parsedId = communityIdSchema.safeParse(communityId);
      if (!parsedId.success) {
        throw new CommunityNotFoundError();
      }
      await inGallery(actor, communityId, async (managed) => {
        assertRoom((await managed.store.listGallery()).length);
        await assertStorageRoom(runtime, managed, upload.bytes.byteLength);
      });
      const prepared = await prepareImage(
        {
          key: communityKey(parsedId.data, "gallery", `${newId()}.${image.extension}`),
          body: upload.bytes,
          contentType: image.contentType,
        },
        runtime.processImage,
      );
      if (prepared.bytes > upload.bytes.byteLength) {
        await inGallery(actor, communityId, async (managed) => {
          await assertStorageRoom(runtime, managed, upload.bytes.byteLength, prepared.bytes);
        });
      }
      const key = await storePreparedImage(runtime.storage, prepared);
      try {
        return await inGallery(actor, communityId, async (managed) => {
          const items = await managed.store.listGallery();
          assertRoom(items.length);
          const item = await managed.store.insertGalleryItem({
            kind: "image",
            storageKey: key,
            embedUrl: null,
            thumbnailUrl: null,
            altText: alt,
            position: nextPosition(items),
          });
          return settle(managed, "added", item.id);
        });
      } catch (error: unknown) {
        await deleteFile(key);
        throw error;
      }
    },

    async addGalleryVideo(
      actor: Actor,
      communityId: string,
      input: AddGalleryVideoInput,
    ): Promise<GalleryItemView[]> {
      const { url, altText } = parseInput(addGalleryVideoInputSchema, input);
      const embed = normalizeVideoLink(url);
      if (!embed) {
        throw new CommunityValidationError([
          { path: "url", message: "Paste a YouTube, Vimeo, or Loom video link." },
        ]);
      }
      await inGallery(actor, communityId, async (managed) => {
        assertRoom((await managed.store.listGallery()).length);
      });
      const thumbnailUrl = await runtime.videoThumbnail(embed.embedUrl);
      return inGallery(actor, communityId, async (managed) => {
        const items = await managed.store.listGallery();
        assertRoom(items.length);
        const item = await managed.store.insertGalleryItem({
          kind: "video_embed",
          storageKey: null,
          embedUrl: embed.embedUrl,
          thumbnailUrl,
          altText: altText ?? null,
          position: nextPosition(items),
        });
        return settle(managed, "added", item.id);
      });
    },

    async updateGalleryItem(
      actor: Actor,
      communityId: string,
      itemId: string,
      input: UpdateGalleryItemInput,
    ): Promise<GalleryItemView[]> {
      const id = parseItemId(itemId);
      const { altText } = parseInput(updateGalleryItemInputSchema, input);
      return inGallery(actor, communityId, async (managed) => {
        const updated = await managed.store.updateGalleryAltText(id, altText);
        if (!updated) {
          throw new GalleryItemNotFoundError();
        }
        return settle(managed, "updated", id);
      });
    },

    async reorderGallery(
      actor: Actor,
      communityId: string,
      input: ReorderGalleryInput,
    ): Promise<GalleryItemView[]> {
      const { itemIds } = parseInput(reorderGalleryInputSchema, input);
      return inGallery(actor, communityId, async (managed) => {
        const current = new Set((await managed.store.listGallery()).map((item) => item.id));
        const requested = new Set(itemIds);
        if (
          requested.size !== itemIds.length ||
          requested.size !== current.size ||
          itemIds.some((id) => !current.has(id))
        ) {
          throw new CommunityValidationError([
            { path: "itemIds", message: "List every gallery item exactly once." },
          ]);
        }
        await managed.store.setGalleryPositions(itemIds);
        return settle(managed, "reordered", null);
      });
    },

    async removeGalleryItem(
      actor: Actor,
      communityId: string,
      itemId: string,
    ): Promise<GalleryItemView[]> {
      const id = parseItemId(itemId);
      const { view, storageKey } = await inGallery(actor, communityId, async (managed) => {
        const removed = await managed.store.deleteGalleryItem(id);
        if (!removed) {
          throw new GalleryItemNotFoundError();
        }
        const remaining = await managed.store.listGallery();
        await managed.store.setGalleryPositions(remaining.map((item) => item.id));
        return { view: await settle(managed, "removed", id), storageKey: removed.storageKey };
      });
      if (storageKey) {
        await deleteFile(storageKey);
      }
      return view;
    },
  };
}
