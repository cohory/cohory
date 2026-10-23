const communityPath = /^\/c\/([^/]+)(\/.*)?$/;

export type MovedSlugLookup = (formerSlug: string) => Promise<string | null>;

export function communityPathSlug(pathname: string): string | null {
  return communityPath.exec(pathname)?.[1] ?? null;
}

export async function movedCommunityLocation(
  url: URL,
  lookup: MovedSlugLookup,
): Promise<string | null> {
  const match = communityPath.exec(url.pathname);
  const formerSlug = match?.[1];
  if (!formerSlug) {
    return null;
  }
  const slug = await lookup(formerSlug);
  if (!slug) {
    return null;
  }
  return `/c/${slug}${match[2] ?? ""}${url.search}`;
}
