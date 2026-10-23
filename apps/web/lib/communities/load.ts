import type { Session } from "@cohory/auth";
import { can, type Actor, type CommunityRole } from "@cohory/authz";
import {
  CommunityNotFoundError,
  getCommunitiesService,
  type CommunityPublicView,
  type CommunityView,
  type MembershipView,
} from "@cohory/communities";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { actorFor } from "../actor";
import { currentSession } from "../session";

interface PageBase {
  readonly session: Session | null;
  readonly actor: Actor;
}

export interface FullCommunityPage extends PageBase {
  readonly access: "full";
  readonly community: CommunityView;
  readonly membership: MembershipView | null;
  readonly role: CommunityRole | null;
  readonly entitled: boolean;
  readonly onboardingDismissed: boolean;
  readonly canManage: boolean;
  readonly canJoin: boolean;
  readonly canLeave: boolean;
}

export interface LimitedCommunityPage extends PageBase {
  readonly access: "limited";
  readonly community: CommunityPublicView;
}

export type CommunityPage = FullCommunityPage | LimitedCommunityPage;

export const loadCommunityPage = cache(async (slug: string): Promise<CommunityPage> => {
  const session = await currentSession();
  const actor = actorFor(session);
  const service = getCommunitiesService();
  let community: CommunityView | CommunityPublicView;
  try {
    community = await service.getCommunityBySlug(actor, slug);
  } catch (error) {
    if (error instanceof CommunityNotFoundError) {
      notFound();
    }
    throw error;
  }
  if (community.access === "limited") {
    return { access: "limited", session, actor, community };
  }
  const { membership, role, entitled, onboardingDismissed } = await service.getAccess(
    actor,
    community.id,
  );
  const context = { role, communityPrivacy: community.privacy };
  const joinable =
    community.joinMode === "open" && (membership === null || membership.status === "removed");
  return {
    access: "full",
    session,
    actor,
    community,
    membership,
    role,
    entitled,
    onboardingDismissed,
    canManage: can(actor, "update", "community", context),
    canJoin:
      joinable &&
      (actor.kind === "guest"
        ? community.privacy === "public"
        : can(actor, "join", "membership", context)),
    canLeave: role !== null && can(actor, "leave", "membership", context),
  };
});

export async function requireFullCommunityPage(slug: string): Promise<FullCommunityPage> {
  const page = await loadCommunityPage(slug);
  if (page.access === "limited") {
    redirect(`/c/${page.community.slug}`);
  }
  return page;
}
