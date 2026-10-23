import type { CommunityAppearance } from "@cohory/db/schema";
import { getStorage, isStorageKey, type StorageDriver } from "@cohory/storage";

import { httpsUrl, instanceUrl } from "./brand";
import type { CommunityBrandInput } from "./templates/layout";

type PublicUrls = () => Pick<StorageDriver, "publicUrl">;

export function emailLogoUrl(url: string | null | undefined): string | null {
  return url ? httpsUrl(new URL(url, `${instanceUrl()}/`).toString()) : null;
}

export function communityEmailBrand(
  appearance: CommunityAppearance | null | undefined,
  storage: PublicUrls = getStorage,
): CommunityBrandInput {
  const logoKey = appearance?.logoKey;
  return {
    logoUrl: logoKey && isStorageKey(logoKey) ? emailLogoUrl(storage().publicUrl(logoKey)) : null,
    accent: appearance?.accent ?? null,
  };
}

export function communityImageUrl(
  appearance: CommunityAppearance | null | undefined,
  storage: PublicUrls = getStorage,
): string | null {
  for (const key of [appearance?.logoKey, appearance?.coverKey]) {
    if (key && isStorageKey(key)) {
      return emailLogoUrl(storage().publicUrl(key));
    }
  }
  return null;
}
