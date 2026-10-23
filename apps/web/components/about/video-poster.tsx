import type { GalleryItemView } from "@cohory/communities";
import type { VideoLinkProvider } from "@cohory/content";
import { Play } from "lucide-react";
import { StoredImage } from "../stored-image";

export const providerNames: Readonly<Record<VideoLinkProvider, string>> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
};

export function VideoPoster({ item }: { item: Extract<GalleryItemView, { kind: "video_embed" }> }) {
  return (
    <span className="relative flex size-full items-center justify-center bg-surface-hover">
      {item.thumbnailUrl ? (
        // Video posters come from the provider's image host, allowed in img-src.
        <StoredImage
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="text-xs font-medium text-text">{providerNames[item.provider]}</span>
      )}
      <span className="absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Play aria-hidden="true" className="size-3" strokeWidth={2} />
      </span>
    </span>
  );
}
