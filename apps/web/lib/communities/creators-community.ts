import { CommunityNotFoundError, getCommunitiesService } from "@cohory/communities";
import { getPlatformConfig } from "@cohory/config/platform";
import { cache } from "react";

export interface CreatorsCommunityLink {
  readonly label: string;
  readonly href: string;
}

// Read as a guest so the footer looks the same to everyone: the name is public on the About page
// even for a private community.
export const loadCreatorsCommunityLink = cache(async (): Promise<CreatorsCommunityLink | null> => {
  const slug = getPlatformConfig().creatorsCommunity;
  if (!slug) {
    return null;
  }
  try {
    const community = await getCommunitiesService().getCommunityBySlug({ kind: "guest" }, slug);
    return { label: community.name, href: `/c/${encodeURIComponent(community.slug)}` };
  } catch (error: unknown) {
    if (error instanceof CommunityNotFoundError) {
      return null;
    }
    throw error;
  }
});
