import { communitySlugSchema, findMovedCommunitySlug, getDb } from "@cohory/db";

export async function findMovedSlug(formerSlug: string): Promise<string | null> {
  const parsed = communitySlugSchema.safeParse(formerSlug);
  return parsed.success ? findMovedCommunitySlug(getDb(), parsed.data) : null;
}
