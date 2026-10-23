import type { ApprovalCategory } from "./credentials";

export class ForbiddenError extends Error {
  readonly code = "forbidden";

  constructor(
    readonly action: string,
    readonly resource: string,
  ) {
    super(`not allowed to ${action} ${resource}`);
    this.name = "ForbiddenError";
  }
}

export class AgentNotAllowedError extends Error {
  readonly code = "not_allowed_for_agents";

  constructor(
    readonly action: string,
    readonly resource: string,
  ) {
    super(`agents may not ${action} ${resource}`);
    this.name = "AgentNotAllowedError";
  }
}

export class ApprovalRequiredError extends Error {
  readonly code = "approval_required";

  constructor(
    readonly action: string,
    readonly resource: string,
    readonly category: ApprovalCategory,
  ) {
    super(`approval required to ${action} ${resource}`);
    this.name = "ApprovalRequiredError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";

  constructor() {
    super("sign in required");
    this.name = "UnauthenticatedError";
  }
}
