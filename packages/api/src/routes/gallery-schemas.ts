import { z } from "@hono/zod-openapi";
import {
  galleryAltTextMaxLength,
  maxGalleryItems,
  type GalleryItemView,
} from "@cohory/communities";

import { slugParams } from "./posts-schemas";

const altText = z
  .string()
  .max(galleryAltTextMaxLength)
  .nullable()
  .openapi({ description: "Describes the image or video for people who use a screen reader." });

const imageItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("image"),
    url: z.string().openapi({ description: "Public URL of the image." }),
    altText,
    position: z.int().nonnegative(),
  })
  .openapi("GalleryImage");

const videoItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("video_embed"),
    provider: z.enum(["youtube", "vimeo", "loom"]),
    url: z.string().openapi({
      description:
        "The normalized embed URL. Load it in a sandboxed frame only after the viewer asks to play it.",
    }),
    thumbnailUrl: z.string().nullable().openapi({
      description:
        "A poster image from the video provider's image host, or null when the provider has none.",
    }),
    altText,
    position: z.int().nonnegative(),
  })
  .openapi("GalleryVideo");

export const galleryItemSchema = z
  .discriminatedUnion("kind", [imageItemSchema, videoItemSchema])
  .openapi("GalleryItem", {
    description: `An item of the About page gallery. The first item is the hero. Up to ${maxGalleryItems} items.`,
  });

export const galleryListSchema = z.array(galleryItemSchema);

export const gallerySchema = z
  .object({ data: galleryListSchema })
  .openapi("Gallery", { description: "Every gallery item in display order." });

export const galleryParams = z.object({
  slug: slugParams.shape.slug,
  itemId: z.uuid().openapi({ param: { name: "itemId", in: "path" } }),
});

export const galleryImageFormSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, { message: "Attach an image file." })
    .openapi({ type: "string", format: "binary" }),
  altText: z.string().max(galleryAltTextMaxLength).optional(),
});

export const addGalleryVideoBodySchema = z
  .object({
    url: z.string().min(1).max(2048).openapi({
      description: "A YouTube, Vimeo, or Loom link over https.",
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
    altText: z.string().max(galleryAltTextMaxLength).nullable().optional(),
  })
  .openapi("AddGalleryVideo");

export const updateGalleryItemBodySchema = z
  .object({ altText: z.string().max(galleryAltTextMaxLength).nullable() })
  .openapi("UpdateGalleryItem");

export const reorderGalleryBodySchema = z
  .object({
    itemIds: z.array(z.uuid()).max(maxGalleryItems).openapi({
      description: "Every gallery item id exactly once, in the new order.",
    }),
  })
  .openapi("ReorderGallery");

export function galleryItemJson(item: GalleryItemView): z.infer<typeof galleryItemSchema> {
  return { ...item };
}

export function galleryJson(items: readonly GalleryItemView[]): z.infer<typeof gallerySchema> {
  return { data: items.map(galleryItemJson) };
}
