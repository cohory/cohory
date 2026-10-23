import type { SignUpMode } from "@cohory/config/platform";

import { safeRedirectPath } from "./redirects";

export interface SignUpLookups {
  inviteActive(token: string): Promise<boolean>;
}

export type SignUpGate = (callbackURL: unknown) => Promise<boolean>;

export const noSignUpLookups: SignUpLookups = {
  inviteActive: async () => false,
};

const invitePath = /^\/join\/([A-Za-z0-9_-]{43})(?:\?accept=1)?$/;

export function signUpGate(mode: SignUpMode, lookups: SignUpLookups): SignUpGate {
  return async (callbackURL) => {
    switch (mode) {
      case "open":
        return true;
      case "closed":
        return false;
      case "invite": {
        const token = invitePath.exec(safeRedirectPath(callbackURL))?.[1];
        return token ? lookups.inviteActive(token) : false;
      }
    }
  };
}
