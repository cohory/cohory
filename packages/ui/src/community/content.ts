export type TextMark = "bold" | "italic" | "link";

export interface TextInline {
  type: "text";
  text: string;
  marks?: TextMark[];
  href?: string;
}

export interface MentionInline {
  type: "mention";
  userId: string;
  label: string;
}

export type Inline = TextInline | MentionInline;

export interface ParagraphBlock {
  type: "paragraph";
  content: Inline[];
}

export interface BulletListBlock {
  type: "bulletList";
  items: Inline[][];
}

export interface ImageBlock {
  type: "image";
  key: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export type EmbedProvider = "youtube" | "vimeo" | "loom";

export interface EmbedBlock {
  type: "embed";
  provider: EmbedProvider;
  url: string;
}

export type Block = ParagraphBlock | BulletListBlock | ImageBlock | EmbedBlock;

export interface PostDocument {
  type: "doc";
  content: Block[];
}

export const MAX_POST_IMAGES = 10;

export function emptyDocument(): PostDocument {
  return { type: "doc", content: [] };
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:", "blob:"]);

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function safeLinkHref(href: string | undefined): string | null {
  if (!href) return null;
  const url = parseAbsoluteUrl(href.trim());
  if (!url || !SAFE_LINK_PROTOCOLS.has(url.protocol)) return null;
  return url.href;
}

export function safeImageSrc(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  const url = parseAbsoluteUrl(trimmed);
  if (!url || !SAFE_IMAGE_PROTOCOLS.has(url.protocol)) return null;
  return url.href;
}

export interface ResolvedEmbed {
  provider: EmbedProvider;
  id: string;
  src: string;
}

const EMBED_ID = /^[A-Za-z0-9_-]{6,64}$/;

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") return url.pathname.split("/")[1] ?? null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const [, kind, id] = url.pathname.split("/");
  return kind === "embed" || kind === "shorts" || kind === "live" ? (id ?? null) : null;
}

function vimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "vimeo.com") return url.pathname.split("/")[1] ?? null;
  if (host === "player.vimeo.com") {
    const [, kind, id] = url.pathname.split("/");
    return kind === "video" ? (id ?? null) : null;
  }
  return null;
}

function loomId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "loom.com") return null;
  const [, kind, id] = url.pathname.split("/");
  return kind === "share" || kind === "embed" ? (id ?? null) : null;
}

function embedSrc(provider: EmbedProvider, id: string): string {
  switch (provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${id}`;
    case "vimeo":
      return `https://player.vimeo.com/video/${id}`;
    case "loom":
      return `https://www.loom.com/embed/${id}`;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function resolveEmbed(rawUrl: string): ResolvedEmbed | null {
  const url = parseAbsoluteUrl(rawUrl.trim());
  if (!url || url.protocol !== "https:") return null;
  const candidates: Array<[EmbedProvider, string | null]> = [
    ["youtube", youtubeId(url)],
    ["vimeo", vimeoId(url)],
    ["loom", loomId(url)],
  ];
  for (const [provider, id] of candidates) {
    if (id && EMBED_ID.test(id)) {
      if (provider === "vimeo" && !/^\d+$/.test(id)) continue;
      return { provider, id, src: embedSrc(provider, id) };
    }
  }
  return null;
}

export const EMBED_PROVIDER_NAMES: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
};
