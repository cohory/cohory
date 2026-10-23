import {
  isVideoThumbnailUrl,
  videoIdOfEmbedUrl,
  videoOembedUrl,
  youtubeThumbnailUrl,
} from "@cohory/content";
import { z } from "zod";

export type VideoThumbnailResolver = (embedUrl: string) => Promise<string | null>;

export type ThumbnailFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface VideoThumbnailOptions {
  readonly fetch?: ThumbnailFetch;
  readonly timeoutMs?: number;
}

const maxResponseBytes = 64 * 1024;
const oembedSchema = z.object({ thumbnail_url: z.string().max(2048) });

export function createVideoThumbnailResolver(
  options: VideoThumbnailOptions = {},
): VideoThumbnailResolver {
  const fetchFn: ThumbnailFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 3000;

  return async (embedUrl) => {
    const video = videoIdOfEmbedUrl(embedUrl);
    if (!video) {
      return null;
    }
    if (video.provider === "youtube") {
      return youtubeThumbnailUrl(video.id);
    }
    const endpoint = videoOembedUrl(video);
    if (!endpoint) {
      return null;
    }
    try {
      const response = await fetchFn(endpoint, {
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return null;
      }
      const body = await response.text();
      if (body.length > maxResponseBytes) {
        return null;
      }
      const parsed = oembedSchema.safeParse(JSON.parse(body));
      return parsed.success && isVideoThumbnailUrl(video.provider, parsed.data.thumbnail_url)
        ? parsed.data.thumbnail_url
        : null;
    } catch {
      return null;
    }
  };
}
