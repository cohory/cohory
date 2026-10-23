import {
  AgentsError,
  ScopeNotAvailableError,
  scopeNotAvailableMessage,
  type AgentsErrorCode,
} from "@cohory/agents";
import {
  ApprovalsError,
  maxPendingPerAgent,
  type ApprovalsErrorCode,
} from "@cohory/agents/approvals";
import {
  AgentNotAllowedError,
  ApprovalRequiredError,
  ForbiddenError,
  UnauthenticatedError,
} from "@cohory/authz";
import {
  delegationDenialMessages,
  DelegationRequiredError,
  EntitlementsError,
  entitlementsErrorDetails,
} from "@cohory/entitlements";
import { LimitReachedError, limitReachedMessage } from "@cohory/fair-use";
import { RateLimitedError } from "@cohory/rate-limit";
import { SearchValidationError } from "@cohory/search";

import { describeWith, fromCatalog, fromClass } from "./match";
import type { Catalog, ErrorKind, ErrorMatcher } from "./types";

export const forbiddenMessage = "You do not have permission to do that.";

export const agentNotAllowedMessage =
  "Agents cannot archive, delete, or transfer a community, even with approval. The owner must do it in Cohory.";

export function rateLimitMessage(error: RateLimitedError): string {
  const seconds = Math.max(1, error.retryAfterSeconds);
  const wait = seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
  return `You're doing that too often. Try again in ${wait}.`;
}

export const agentsCatalog = {
  not_found: { kind: "not_found", message: "We could not find that agent or token." },
  agent_not_active: {
    kind: "conflict",
    message: "This agent is paused or revoked. Resume it first.",
  },
} satisfies Catalog<AgentsErrorCode, AgentsError>;

export const approvalsCatalog = {
  not_found: { kind: "not_found", message: "We could not find that approval request." },
  limit_reached: {
    kind: "rate_limited",
    message: `This agent already has ${maxPendingPerAgent} requests waiting for a person. Wait until someone approves or rejects them.`,
  },
  expired: {
    kind: "conflict",
    message: "This request expired after 72 hours. The agent can ask again.",
  },
  reauth_required: {
    kind: "forbidden",
    message:
      "For your safety, sign in again before you approve. Approvals need a sign in from the last 10 minutes.",
  },
  agent_inactive: {
    kind: "conflict",
    message: "The agent was paused or revoked, so this request was rejected.",
  },
  download_unavailable: {
    kind: "gone",
    message: "This download was already used, has expired, or is not approved.",
  },
} satisfies Catalog<ApprovalsErrorCode, ApprovalsError>;

const entitlementKinds: Readonly<Record<403 | 404 | 409, ErrorKind>> = {
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

const entitlementsMatcher: ErrorMatcher = (error, audience) => {
  if (!(error instanceof EntitlementsError)) return null;
  const { status, message } = entitlementsErrorDetails[error.code];
  return describeWith({ kind: entitlementKinds[status], message }, error.code, error, audience);
};

const searchMessage = "Type at least 2 characters, including a word.";

export const accessMatchers: readonly ErrorMatcher[] = [
  fromClass(UnauthenticatedError, "unauthenticated", {
    kind: "unauthenticated",
    message: "Sign in to continue.",
  }),
  fromClass(RateLimitedError, "rate_limited", {
    kind: "rate_limited",
    message: rateLimitMessage,
    retryAfterSeconds: (error) => error.retryAfterSeconds,
  }),
  fromClass(LimitReachedError, "limit_reached", {
    kind: "conflict",
    message: limitReachedMessage,
    details: (error) => ({ resource: error.resource, limit: error.limit, used: error.used }),
  }),
  fromClass(ApprovalRequiredError, "approval_required", {
    kind: "forbidden",
    message:
      'An agent cannot do this on its own. Give it the "Propose changes" permission (proposals:write) so it can ask a person to approve it.',
    details: (error) => ({ action: `${error.resource}.${error.action}`, category: error.category }),
  }),
  fromCatalog(ApprovalsError, approvalsCatalog),
  fromCatalog(AgentsError, agentsCatalog),
  fromClass(ScopeNotAvailableError, "scope_not_available", {
    kind: "forbidden",
    message: scopeNotAvailableMessage,
    details: (error) => ({ scopes: error.scopes }),
  }),
  fromClass(DelegationRequiredError, "delegation_required", {
    kind: "forbidden",
    message: (error) => delegationDenialMessages[error.reason],
    details: (error) => ({ reason: error.reason }),
  }),
  entitlementsMatcher,
  fromClass(AgentNotAllowedError, "not_allowed_for_agents", {
    kind: "forbidden",
    message: agentNotAllowedMessage,
  }),
  fromClass(ForbiddenError, "forbidden", { kind: "forbidden", message: forbiddenMessage }),
  fromClass(SearchValidationError, "validation_failed", {
    kind: "validation",
    message: searchMessage,
    issues: () => [{ path: "q", message: searchMessage }],
  }),
];
