import type { SignUpLookups } from "@cohory/auth";
import { getManageService } from "@cohory/communities";

export const communitySignUpLookups: SignUpLookups = {
  inviteActive: async (token) =>
    (await getManageService().previewInvite(token))?.status === "active",
};
