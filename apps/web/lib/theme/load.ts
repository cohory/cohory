import { getManageService, type AppearanceView } from "@cohory/communities";
import { cache } from "react";

export const loadCommunityAppearance = cache((communityId: string): Promise<AppearanceView> =>
  getManageService().getAppearance(communityId),
);
