import { EMBED_PROVIDER_NAMES, resolveEmbed, type EmbedProvider } from "../community/content";

export type CourseStatus = "draft" | "published" | "archived";
export type LessonStatus = "draft" | "published";
export type LessonVideoProvider = EmbedProvider | "wistia";

export interface CourseSummary {
  slug: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  lessonCount: number;
  status?: CourseStatus;
  requiredLevel?: number | null;
  locked?: boolean;
}

export interface LessonAttachment {
  id?: string;
  name: string;
  href: string;
  size: number;
  contentType: string;
}

export interface ResolvedLessonVideo {
  provider: LessonVideoProvider;
  id: string;
  src: string;
  name: string;
}

export const LESSON_VIDEO_PROVIDER_NAMES: Record<LessonVideoProvider, string> = {
  ...EMBED_PROVIDER_NAMES,
  wistia: "Wistia",
};

const WISTIA_ID = /^[a-z0-9]{6,32}$/;

function wistiaId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname;
  const [, first, second, third] = url.pathname.split("/");
  if (host === "fast.wistia.net" || host === "fast.wistia.com") {
    return first === "embed" && (second === "iframe" || second === "medias")
      ? (third ?? null)
      : null;
  }
  if (host.endsWith(".wistia.com") || host === "wistia.com") {
    return first === "medias" ? (second ?? null) : null;
  }
  return null;
}

export function resolveLessonVideo(
  rawUrl: string,
  provider?: LessonVideoProvider | null,
): ResolvedLessonVideo | null {
  const embed = resolveEmbed(rawUrl);
  if (embed) {
    if (provider && provider !== embed.provider) return null;
    return { ...embed, name: LESSON_VIDEO_PROVIDER_NAMES[embed.provider] };
  }
  const id = wistiaId(rawUrl);
  if (!id || !WISTIA_ID.test(id)) return null;
  if (provider && provider !== "wistia") return null;
  return {
    provider: "wistia",
    id,
    src: `https://fast.wistia.net/embed/iframe/${id}`,
    name: LESSON_VIDEO_PROVIDER_NAMES.wistia,
  };
}

export function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), 100));
}

export function progressLabel(percent: number): string {
  const value = normalizePercent(percent);
  if (value === 0) return "Not started";
  if (value === 100) return "Completed";
  return `${value}% complete`;
}

export function lessonCountLabel(count: number, locale?: string): string {
  const formatted = new Intl.NumberFormat(locale).format(count);
  return count === 1 ? "1 lesson" : `${formatted} lessons`;
}

const FILE_UNITS = ["KB", "MB", "GB"] as const;

export function formatFileSize(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < FILE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
  return `${formatted} ${FILE_UNITS[unit]}`;
}
