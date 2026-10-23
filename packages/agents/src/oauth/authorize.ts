import { defaultScopes, scopeDetails, type Scope } from "@cohory/authz";

import { findClient, type ClientRow, type OAuthServiceDeps } from "./context";
import { sameResource } from "./metadata";
import { isLoopbackRedirect, redirectHost, withQuery } from "./redirect-uri";
import {
  authorizationRequestSchema,
  isCodeChallenge,
  parseScopeParam,
  type AuthorizationRequestInput,
} from "./schemas";

export interface AuthorizationRequest {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly clientUri: string | null;
  };
  readonly redirectUri: string;
  readonly redirectHost: string;
  readonly loopbackRedirect: boolean;
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly requestedScopes: readonly Scope[] | null;
  readonly preselectedScopes: readonly Scope[];
  readonly resource: string;
}

export type AuthorizationCheck =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "ok"; readonly request: AuthorizationRequest };

export function errorRedirect(
  issuer: string,
  redirectUri: string,
  state: string | null | undefined,
  error: string,
  description: string,
): string {
  return withQuery(redirectUri, {
    error,
    error_description: description,
    ...(state ? { state } : {}),
    iss: issuer,
  });
}

function preselect(requested: readonly Scope[] | null): Scope[] {
  return defaultScopes.filter(
    (scope) =>
      scopeDetails[scope].access === "read" && (requested === null || requested.includes(scope)),
  );
}

export async function checkAuthorizationRequest(
  deps: OAuthServiceDeps,
  raw: unknown,
): Promise<AuthorizationCheck> {
  const parsed = authorizationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "invalid",
      message: "This sign in link is malformed. Start again from the app.",
    };
  }
  const input: AuthorizationRequestInput = parsed.data;
  const client: ClientRow | null = await findClient(deps.db, input.client_id);
  if (!client) {
    return {
      kind: "invalid",
      message: "We do not know this app. Start the connection again from the app.",
    };
  }
  if (!input.redirect_uri || !client.redirectUris.includes(input.redirect_uri)) {
    return {
      kind: "invalid",
      message:
        "The app asked to send you to an address it did not register. For your safety we stopped here.",
    };
  }
  const fail = (error: string, description: string): AuthorizationCheck => ({
    kind: "redirect",
    url: errorRedirect(
      deps.issuer.issuer,
      input.redirect_uri ?? "",
      input.state,
      error,
      description,
    ),
  });
  if (input.response_type !== "code") {
    return fail("unsupported_response_type", "response_type must be code");
  }
  if (!input.code_challenge || !isCodeChallenge(input.code_challenge)) {
    return fail("invalid_request", "code_challenge is required (PKCE S256)");
  }
  if (input.code_challenge_method !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256");
  }
  if (input.resource !== undefined && !sameResource(input.resource, deps.issuer.resource)) {
    return fail("invalid_target", `resource must be ${deps.issuer.resource}`);
  }
  const scope = parseScopeParam(input.scope);
  const requested = scope && scope.known.length > 0 ? scope.known : null;
  return {
    kind: "ok",
    request: {
      client: { id: client.id, name: client.clientName, clientUri: client.clientUri },
      redirectUri: input.redirect_uri,
      redirectHost: redirectHost(input.redirect_uri),
      loopbackRedirect: isLoopbackRedirect(input.redirect_uri),
      state: input.state ?? null,
      codeChallenge: input.code_challenge,
      requestedScopes: requested,
      preselectedScopes: preselect(requested),
      resource: deps.issuer.resource,
    },
  };
}
