import { scopeDetails, type Scope } from "@cohory/authz";

export const invalidTokenReasons = [
  "malformed",
  "unknown",
  "revoked",
  "expired",
  "agent_suspended",
  "agent_revoked",
  "membership_required",
] as const;

export type InvalidTokenReason = (typeof invalidTokenReasons)[number];

export class InvalidTokenError extends Error {
  readonly code = "invalid_token";

  readonly oauth: boolean;

  constructor(
    readonly reason: InvalidTokenReason,
    options: { readonly oauth?: boolean } = {},
  ) {
    super(`api token refused: ${reason}`);
    this.name = "InvalidTokenError";
    this.oauth = options.oauth ?? false;
  }
}

export type AgentsErrorCode = "not_found" | "agent_not_active";

export class AgentsError extends Error {
  constructor(readonly code: AgentsErrorCode) {
    super(code);
    this.name = "AgentsError";
  }
}

export interface AgentsIssue {
  readonly path: string;
  readonly message: string;
}

export class AgentsValidationError extends Error {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly AgentsIssue[]) {
    super("validation failed");
    this.name = "AgentsValidationError";
  }
}

export class ScopeNotAvailableError extends Error {
  readonly code = "scope_not_available";

  constructor(readonly scopes: readonly Scope[]) {
    super(`scopes not available: ${scopes.join(", ")}`);
    this.name = "ScopeNotAvailableError";
  }
}

export function scopeNotAvailableMessage(error: ScopeNotAvailableError): string {
  const labels = error.scopes.map((scope) => `"${scopeDetails[scope].label}"`).join(", ");
  return `Your role cannot use ${labels}. Choose only the permissions shown.`;
}
