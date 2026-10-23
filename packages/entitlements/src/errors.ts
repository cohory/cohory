import type { DelegationDenial } from "./access";

export const entitlementsErrorCodes = [
  "not_found",
  "agent_not_found",
  "agent_inactive",
  "no_access",
  "agent_access_off",
  "already_delegated",
  "cannot_renew",
  "redelegation_refused",
  "agents_only",
  "duplicate_submission",
] as const;

export type EntitlementsErrorCode = (typeof entitlementsErrorCodes)[number];

export class EntitlementsError extends Error {
  constructor(readonly code: EntitlementsErrorCode) {
    super(code);
    this.name = "EntitlementsError";
  }
}

export class DelegationRequiredError extends Error {
  readonly code = "delegation_required";

  constructor(readonly reason: DelegationDenial) {
    super(`delegation required: ${reason}`);
    this.name = "DelegationRequiredError";
  }
}

export interface EntitlementsIssue {
  readonly path: string;
  readonly message: string;
}

export class EntitlementsValidationError extends Error {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly EntitlementsIssue[]) {
    super("validation failed");
    this.name = "EntitlementsValidationError";
  }
}

export const entitlementsErrorDetails: Readonly<
  Record<EntitlementsErrorCode, { readonly status: 403 | 404 | 409; readonly message: string }>
> = {
  not_found: { status: 404, message: "We could not find that course or delegation." },
  agent_not_found: {
    status: 404,
    message: "We could not find that agent. Pick one of your own agents.",
  },
  agent_inactive: { status: 409, message: "This agent is paused or revoked. Resume it first." },
  no_access: {
    status: 403,
    message: "You need access to this course before you can share it with an agent.",
  },
  agent_access_off: {
    status: 409,
    message: "The creator has not turned on agent access for this course.",
  },
  already_delegated: {
    status: 409,
    message: "This agent already has access to this course. Renew it instead.",
  },
  cannot_renew: {
    status: 409,
    message: "This access has ended. Give access again to start a new 30 day period.",
  },
  redelegation_refused: {
    status: 403,
    message: "Agents cannot give course access to other agents. A person must do it.",
  },
  agents_only: { status: 403, message: "Only an agent token can submit results." },
  duplicate_submission: {
    status: 409,
    message: "This agent already submitted a result for this task in this run.",
  },
};

export const delegationDenialMessages: Readonly<Record<DelegationDenial, string>> = {
  no_delegation:
    "This agent has no access to this course. The person who owns it can give access on the course page.",
  expired: "This agent's access to the course expired. Its person can renew it on the course page.",
  revoked: "This agent's access to the course was revoked.",
  human_access_ended:
    "The person who owns this agent no longer has access to the course, so the agent does not either.",
  agent_inactive: "This agent is paused or revoked.",
  agent_access_off: "The creator does not allow agents to read this course.",
  wrong_community: "This token belongs to a different community.",
};
