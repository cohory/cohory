import { emailLogoUrl, type CommunityBrandInput } from "@cohory/email";

import { loadCommunityAppearance } from "./load";

export async function communityEmailBrandFor(communityId: string): Promise<CommunityBrandInput> {
  const appearance = await loadCommunityAppearance(communityId);
  return { logoUrl: emailLogoUrl(appearance.logoUrl), accent: appearance.accent };
}
