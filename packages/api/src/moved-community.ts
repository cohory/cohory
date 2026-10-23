import { CommunityNotFoundError, type CommunitiesService } from "@cohory/communities";

const communityPath = /^\/api\/v1\/communities\/([^/]+)(\/.*)?$/;

export async function movedCommunityLocation(
  error: unknown,
  requestUrl: string,
  communities: Pick<CommunitiesService, "findMovedSlug">,
): Promise<string | null> {
  if (!(error instanceof CommunityNotFoundError)) {
    return null;
  }
  const url = new URL(requestUrl);
  const match = communityPath.exec(url.pathname);
  const formerSlug = match?.[1];
  if (!formerSlug) {
    return null;
  }
  const slug = await communities.findMovedSlug(formerSlug);
  return slug ? `/api/v1/communities/${slug}${match[2] ?? ""}${url.search}` : null;
}
