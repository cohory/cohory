export const embedProviders = ["youtube", "vimeo", "loom", "wistia"] as const;
export type EmbedProvider = (typeof embedProviders)[number];

const hosts: ReadonlyMap<string, EmbedProvider> = new Map<string, EmbedProvider>([
  ["youtube.com", "youtube"],
  ["www.youtube.com", "youtube"],
  ["m.youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["vimeo.com", "vimeo"],
  ["www.vimeo.com", "vimeo"],
  ["player.vimeo.com", "vimeo"],
  ["loom.com", "loom"],
  ["www.loom.com", "loom"],
  ["fast.wistia.net", "wistia"],
  ["fast.wistia.com", "wistia"],
]);

const wistiaAccountHost = /^[a-z0-9-]+\.wistia\.com$/;

export function embedProviderOf(raw: string): EmbedProvider | null {
  if (!raw.startsWith("https://")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null;
  }
  const provider = hosts.get(url.hostname);
  if (provider) {
    return provider;
  }
  return wistiaAccountHost.test(url.hostname) ? "wistia" : null;
}

export const videoLinkProviders = ["youtube", "vimeo", "loom"] as const;
export type VideoLinkProvider = (typeof videoLinkProviders)[number];

export interface VideoEmbed {
  readonly provider: VideoLinkProvider;
  readonly embedUrl: string;
}

const embedId = /^[A-Za-z0-9_-]{6,64}$/;

function pathParts(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function youtubeId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    return pathParts(url)[0] ?? null;
  }
  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }
  const [kind, id] = pathParts(url);
  return kind === "embed" || kind === "shorts" || kind === "live" ? (id ?? null) : null;
}

function vimeoId(url: URL): string | null {
  const [first, second] = pathParts(url);
  const id = url.hostname === "player.vimeo.com" ? (first === "video" ? second : null) : first;
  return id && /^\d+$/.test(id) ? id : null;
}

function loomId(url: URL): string | null {
  const [kind, id] = pathParts(url);
  return kind === "share" || kind === "embed" ? (id ?? null) : null;
}

const embedUrlOf: Readonly<Record<VideoLinkProvider, (id: string) => string>> = {
  youtube: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  vimeo: (id) => `https://player.vimeo.com/video/${id}`,
  loom: (id) => `https://www.loom.com/embed/${id}`,
};

const idOf: Readonly<Record<VideoLinkProvider, (url: URL) => string | null>> = {
  youtube: youtubeId,
  vimeo: vimeoId,
  loom: loomId,
};

function isVideoLinkProvider(provider: EmbedProvider): provider is VideoLinkProvider {
  return (videoLinkProviders as readonly string[]).includes(provider);
}

export function normalizeVideoLink(raw: string): VideoEmbed | null {
  const trimmed = raw.trim();
  const provider = embedProviderOf(trimmed);
  if (!provider || !isVideoLinkProvider(provider)) {
    return null;
  }
  const id = idOf[provider](new URL(trimmed));
  if (!id || !embedId.test(id)) {
    return null;
  }
  return { provider, embedUrl: embedUrlOf[provider](id) };
}

export function videoProviderOfEmbedUrl(embedUrl: string): VideoLinkProvider | null {
  for (const provider of videoLinkProviders) {
    const id = embedUrl.slice(embedUrlOf[provider]("").length);
    if (embedUrl === embedUrlOf[provider](id) && embedId.test(id)) {
      return provider;
    }
  }
  return null;
}

export interface VideoEmbedId {
  readonly provider: VideoLinkProvider;
  readonly id: string;
}

export function videoIdOfEmbedUrl(embedUrl: string): VideoEmbedId | null {
  const provider = videoProviderOfEmbedUrl(embedUrl);
  return provider ? { provider, id: embedUrl.slice(embedUrlOf[provider]("").length) } : null;
}

export type PlayerStart = "muted-autoplay" | "on-click";

const playerParams: Readonly<Record<VideoLinkProvider, Record<PlayerStart, string>>> = {
  youtube: {
    "muted-autoplay": "autoplay=1&mute=1&playsinline=1",
    "on-click": "autoplay=1&playsinline=1",
  },
  vimeo: {
    "muted-autoplay": "autoplay=1&muted=1&playsinline=1&dnt=1",
    "on-click": "autoplay=1&playsinline=1&dnt=1",
  },
  loom: {
    "muted-autoplay": "autoplay=1&muted=1",
    "on-click": "autoplay=1",
  },
};

export function videoPlayerUrl(embedUrl: string, start: PlayerStart): string | null {
  const video = videoIdOfEmbedUrl(embedUrl);
  return video
    ? `${embedUrlOf[video.provider](video.id)}?${playerParams[video.provider][start]}`
    : null;
}

export const videoThumbnailHosts: Readonly<Record<VideoLinkProvider, string>> = {
  youtube: "i.ytimg.com",
  vimeo: "i.vimeocdn.com",
  loom: "cdn.loom.com",
};

export function youtubeThumbnailUrl(id: string): string {
  return `https://${videoThumbnailHosts.youtube}/vi/${id}/hqdefault.jpg`;
}

const youtubePosterSizes = ["maxresdefault", "sddefault"] as const;

export function youtubePosterUrls(id: string): readonly string[] {
  return [
    ...youtubePosterSizes.map(
      (size) => `https://${videoThumbnailHosts.youtube}/vi/${id}/${size}.jpg`,
    ),
    youtubeThumbnailUrl(id),
  ];
}

export function videoPosterUrls(embedUrl: string, stored: string | null): readonly string[] {
  const video = videoIdOfEmbedUrl(embedUrl);
  if (video?.provider === "youtube") {
    return youtubePosterUrls(video.id);
  }
  return stored ? [stored] : [];
}

export function isVideoThumbnailUrl(provider: VideoLinkProvider, raw: string): boolean {
  if (raw.length > 2048) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.hostname === videoThumbnailHosts[provider]
  );
}

const oembedEndpoints: Readonly<Record<"vimeo" | "loom", (id: string) => string>> = {
  vimeo: (id) =>
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
  loom: (id) =>
    `https://www.loom.com/v1/oembed?url=${encodeURIComponent(`https://www.loom.com/share/${id}`)}`,
};

export function videoOembedUrl(video: VideoEmbedId): string | null {
  return video.provider === "youtube" ? null : oembedEndpoints[video.provider](video.id);
}
