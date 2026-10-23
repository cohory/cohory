import type { MentionResolver, MentionSuggestion, UploadedImage } from "@cohory/ui";
import { z } from "zod";

import { searchMentionsAction } from "../../lib/posts/actions";
import { pickMention } from "../../lib/posts/mentions";

const uploadedSchema = z.object({ key: z.string().min(1), url: z.string().min(1) });
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export async function uploadPostImage(slug: string, file: File): Promise<UploadedImage> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `/api/v1/communities/${encodeURIComponent(slug)}/uploads/post-image`,
    { method: "POST", body, credentials: "same-origin" },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(parsed.success ? parsed.data.error.message : "The image didn't upload.");
  }
  return uploadedSchema.parse(json);
}

export function mentionSearch(slug: string): (query: string) => Promise<MentionSuggestion[]> {
  return async (query) => {
    const result = await searchMentionsAction({ slug, query });
    return result.ok ? result.data.map((candidate) => ({ ...candidate })) : [];
  };
}

const scheduledFormat: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};

export function scheduledToast(at: Date, locale?: string): string {
  const day = new Intl.DateTimeFormat(locale, scheduledFormat).format(at);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `Scheduled for ${day}, ${time}.`;
}

export function mentionResolver(slug: string): MentionResolver {
  const cache = new Map<string, Promise<ReturnType<typeof pickMention>>>();
  return (username) => {
    const cached = cache.get(username);
    if (cached) return cached;
    const pending = searchMentionsAction({ slug, query: username }).then((result) =>
      result.ok ? pickMention(result.data, username) : null,
    );
    cache.set(username, pending);
    return pending;
  };
}
