import { getCommunitiesService } from "@cohory/communities";

import { actorFor } from "../actor";
import { currentSession } from "../session";
import { CommunityUnavailableError } from "./errors";
import type { CommunityAccess } from "./permissions";

export interface CommunityContext {
  readonly communityId: string;
  readonly slug: string;
  readonly access: CommunityAccess;
}

export async function resolveCommunity(slug: string): Promise<CommunityContext> {
  const actor = actorFor(await currentSession());
  const service = getCommunitiesService();
  const community = await service.getCommunityBySlug(actor, slug);
  if (community.access !== "full") {
    throw new CommunityUnavailableError();
  }
  const { role, entitled } = await service.getAccess(actor, community.id);
  return {
    communityId: community.id,
    slug: community.slug,
    access: { actor, role, entitled, privacy: community.privacy },
  };
}
