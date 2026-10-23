import { getDb } from "@cohory/db";

import { checkAuthorizationRequest } from "./authorize";
import { createConnectedApps } from "./connected";
import { createConsent } from "./consent";
import type { OAuthServiceDeps } from "./context";
import { authorizationServerMetadata, issuerFromEnv, protectedResourceMetadata } from "./metadata";
import { createRegistration } from "./register";
import { createTokenEndpoint } from "./tokens";

export function createOAuthService(deps: OAuthServiceDeps) {
  const consent = createConsent(deps);
  const tokens = createTokenEndpoint(deps);
  const connected = createConnectedApps(deps);
  return {
    issuer: deps.issuer,
    protectedResourceMetadata: () => protectedResourceMetadata(deps.issuer),
    authorizationServerMetadata: () => authorizationServerMetadata(deps.issuer),
    register: createRegistration(deps),
    checkAuthorizationRequest: (raw: unknown) => checkAuthorizationRequest(deps, raw),
    consentOptions: consent.options,
    approve: consent.approve,
    deny: consent.deny,
    token: tokens.token,
    revoke: tokens.revoke,
    listConnectedApps: connected.listForCommunity,
    listMyConnectedApps: connected.listForUser,
    disconnect: connected.disconnect,
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;

let defaultService: OAuthService | undefined;

export function getOAuthService(): OAuthService {
  defaultService ??= createOAuthService({ db: getDb(), issuer: issuerFromEnv() });
  return defaultService;
}
