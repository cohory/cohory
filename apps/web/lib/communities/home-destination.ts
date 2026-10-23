import type { Edition } from "@cohory/config/edition";

import { hasMarketingPages } from "../marketing/edition";

export type HomeDestination =
  | { readonly kind: "redirect"; readonly href: string }
  | { readonly kind: "signed-out" }
  | { readonly kind: "landing" }
  | { readonly kind: "list" };

export interface HomeDestinationInput {
  readonly slugs: readonly string[] | null;
  readonly showList: boolean;
  readonly homeCommunity: string | null;
  readonly edition: Edition;
}

export const myCommunitiesHref = "/?home=1";

export function homeDestination({
  slugs,
  showList,
  homeCommunity,
  edition,
}: HomeDestinationInput): HomeDestination {
  if (slugs === null) {
    if (homeCommunity) {
      return { kind: "redirect", href: `/c/${encodeURIComponent(homeCommunity)}/about` };
    }
    return hasMarketingPages(edition) ? { kind: "landing" } : { kind: "signed-out" };
  }
  const [only] = slugs;
  if (slugs.length === 1 && only !== undefined && !showList) {
    return { kind: "redirect", href: `/c/${encodeURIComponent(only)}` };
  }
  return { kind: "list" };
}
