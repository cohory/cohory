import { communitySlugSchema, type CommunitySlug } from "@cohory/db";
import { z } from "zod";

import { SlugReservedError } from "../errors";
import { reservedSlugs } from "../schemas";
import { parseInput } from "./context";

export const slugChangeIntervalDays = 30;

const intervalMs = slugChangeIntervalDays * 24 * 60 * 60 * 1000;

export const changeSlugInputSchema = z.strictObject({
  slug: z.string().trim().pipe(communitySlugSchema),
});

export type ChangeSlugInput = z.input<typeof changeSlugInputSchema>;

export function parseNewSlug(slug: string): CommunitySlug {
  const parsed = parseInput(changeSlugInputSchema, { slug }).slug;
  if (reservedSlugs.has(parsed)) {
    throw new SlugReservedError(parsed);
  }
  return parsed;
}

export function nextSlugChangeAt(lastChangedAt: Date | null): Date | null {
  return lastChangedAt ? new Date(lastChangedAt.getTime() + intervalMs) : null;
}

export function slugChangeAllowed(lastChangedAt: Date | null, now: Date): boolean {
  const next = nextSlugChangeAt(lastChangedAt);
  return next === null || now.getTime() >= next.getTime();
}
