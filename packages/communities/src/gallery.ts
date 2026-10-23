import {
  isVideoThumbnailUrl,
  videoIdOfEmbedUrl,
  youtubeThumbnailUrl,
  type VideoLinkProvider,
} from "@cohory/content";
import type { CommunityGalleryItem } from "@cohory/db/schema";
import { imageVariantWidths } from "@cohory/storage";

export { galleryAltTextMaxLength, maxGalleryItems } from "@cohory/db/schema";

export type GalleryItemView =
  | {
      readonly id: string;
      readonly kind: "image";
      readonly url: string;
      readonly altText: string | null;
      readonly position: number;
    }
  | {
      readonly id: string;
      readonly kind: "video_embed";
      readonly provider: VideoLinkProvider;
      readonly url: string;
      readonly thumbnailUrl: string | null;
      readonly altText: string | null;
      readonly position: number;
    };

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const storedImageSuffix = `(?:(?:\\.sized)?\\.(?:png|jpg|webp|gif)|\\.w(?:${imageVariantWidths.join("|")})\\.webp)`;
const galleryKeyPattern = new RegExp(
  `^communities\\/${uuid}\\/gallery\\/${uuid}${storedImageSuffix}$`,
);

export function isGalleryKey(key: string): boolean {
  return galleryKeyPattern.test(key);
}

function thumbnailOf(
  provider: VideoLinkProvider,
  id: string,
  stored: string | null,
): string | null {
  if (stored && isVideoThumbnailUrl(provider, stored)) {
    return stored;
  }
  return provider === "youtube" ? youtubeThumbnailUrl(id) : null;
}

export function toGalleryItemView(
  item: CommunityGalleryItem,
  fileUrl: (key: string) => string,
): GalleryItemView | null {
  if (item.kind === "image") {
    return item.storageKey
      ? {
          id: item.id,
          kind: "image",
          url: fileUrl(item.storageKey),
          altText: item.altText,
          position: item.position,
        }
      : null;
  }
  const video = item.embedUrl ? videoIdOfEmbedUrl(item.embedUrl) : null;
  return video && item.embedUrl
    ? {
        id: item.id,
        kind: "video_embed",
        provider: video.provider,
        url: item.embedUrl,
        thumbnailUrl: thumbnailOf(video.provider, video.id, item.thumbnailUrl),
        altText: item.altText,
        position: item.position,
      }
    : null;
}

export function toGalleryView(
  items: readonly CommunityGalleryItem[],
  fileUrl: (key: string) => string,
): GalleryItemView[] {
  return items.flatMap((item) => {
    const view = toGalleryItemView(item, fileUrl);
    return view ? [view] : [];
  });
}
