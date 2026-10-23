import { defaultScopes, scopes } from "@cohory/authz";
import { parseAppUrl } from "@cohory/config/platform";

export const accessTokenSeconds = 60 * 60;
export const refreshTokenSeconds = 30 * 24 * 60 * 60;
export const authorizationCodeSeconds = 60;

export interface OAuthIssuer {
  readonly issuer: string;
  readonly resource: string;
}

export function oauthIssuer(appUrl: string): OAuthIssuer {
  const issuer = new URL(appUrl).origin;
  return { issuer, resource: `${issuer}/mcp` };
}

export function issuerFromEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  return oauthIssuer(parseAppUrl(env));
}

export function protectedResourceMetadata({ issuer, resource }: OAuthIssuer) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...defaultScopes],
    bearer_methods_supported: ["header"],
    resource_name: "Cohory",
    resource_documentation: `${issuer}/api/openapi.json`,
  };
}

export function authorizationServerMetadata({ issuer }: OAuthIssuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...scopes],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}

export function sameResource(candidate: string, resource: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hash !== "" || candidate.includes("#") || url.search !== "") {
    return false;
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return normalized === resource;
}
