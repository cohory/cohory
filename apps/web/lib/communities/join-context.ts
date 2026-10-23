import {
  CommunityNotFoundError,
  getCommunitiesService,
  getManageService,
} from "@cohory/communities";
import { cache } from "react";

import { loadActivePlan } from "../payments/load";
import { loadCommunityAppearance } from "../theme/load";
import { joinOffer } from "./about-offer";
import { joinIntentLine, planPrice, type JoinIntentContext } from "./join-copy";
import { parseJoinContinuePath, type JoinIntent } from "./join-intent";

const guest = { kind: "guest" } as const;

export interface JoinCommunityCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly privacy: "public" | "private";
  readonly coverUrl: string | null;
  readonly logoUrl: string | null;
  readonly memberCount: number;
  readonly owner: string | null;
  readonly price: string | null;
}

export const loadJoinCommunityCard = cache(
  async (slug: string): Promise<JoinCommunityCard | null> => {
    const service = getCommunitiesService();
    let community: Awaited<ReturnType<typeof service.getCommunityBySlug>>;
    try {
      community = await service.getCommunityBySlug(guest, slug);
    } catch (error) {
      if (error instanceof CommunityNotFoundError) return null;
      throw error;
    }
    const [appearance, plan, about] = await Promise.all([
      loadCommunityAppearance(community.id),
      loadActivePlan(community.id),
      service.getAbout(guest, community.id),
    ]);
    return {
      id: community.id,
      slug: community.slug,
      name: community.name,
      description: community.description,
      privacy: community.privacy,
      coverUrl: community.coverUrl,
      logoUrl: appearance.logoUrl,
      memberCount: community.memberCount,
      owner: about.owner?.name ?? null,
      price: joinOffer(plan).price,
    };
  },
);

export interface JoinIntentHeader {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly signUpLine: string;
  readonly signInLine: string;
}

async function invitedSlug(token: string): Promise<string | null> {
  const preview = await getManageService().previewInvite(token);
  return preview?.status === "active" ? preview.community.slug : null;
}

async function intentContext(
  card: JoinCommunityCard,
  intent: JoinIntent,
): Promise<JoinIntentContext> {
  if (intent === "join" || intent === "request") {
    return { name: card.name, intent, price: null, provider: null };
  }
  const plan = await loadActivePlan(card.id);
  return {
    name: card.name,
    intent: "checkout",
    price: plan ? planPrice(plan, intent) : null,
    provider: plan?.providerName ?? null,
  };
}

export async function loadJoinIntentHeader(next: string): Promise<JoinIntentHeader | null> {
  const target = parseJoinContinuePath(next);
  if (!target || target.kind === "post") return null;
  const slug = target.kind === "invite" ? await invitedSlug(target.token) : target.slug;
  const card = slug ? await loadJoinCommunityCard(slug) : null;
  if (!card) return null;
  const context = await intentContext(card, target.kind === "invite" ? "join" : target.intent);
  return {
    name: card.name,
    logoUrl: card.logoUrl,
    signUpLine: joinIntentLine(context, "sign_up"),
    signInLine: joinIntentLine(context, "sign_in"),
  };
}
