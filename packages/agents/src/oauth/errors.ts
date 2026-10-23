export const oauthErrorCodes = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_response_type",
  "invalid_scope",
  "invalid_target",
  "invalid_redirect_uri",
  "invalid_client_metadata",
  "access_denied",
] as const;

export type OAuthErrorCode = (typeof oauthErrorCodes)[number];

const statusFor: Readonly<Record<OAuthErrorCode, number>> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  unsupported_response_type: 400,
  invalid_scope: 400,
  invalid_target: 400,
  invalid_redirect_uri: 400,
  invalid_client_metadata: 400,
  access_denied: 403,
};

export class OAuthError extends Error {
  readonly status: number;

  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
  ) {
    super(`${code}: ${description}`);
    this.name = "OAuthError";
    this.status = statusFor[code];
  }

  toJSON(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.code, error_description: this.description };
  }
}

export type ConsentErrorCode =
  "not_allowed" | "agent_not_found" | "agent_not_active" | "no_scopes" | "invalid_name";

export class ConsentError extends Error {
  constructor(readonly code: ConsentErrorCode) {
    super(code);
    this.name = "ConsentError";
  }
}
