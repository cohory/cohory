export type GamificationErrorCode = "not_found" | "validation_failed";

export interface GamificationValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class GamificationError extends Error {
  abstract readonly code: GamificationErrorCode;
}

export class GamificationCommunityNotFoundError extends GamificationError {
  readonly code = "not_found";

  constructor() {
    super("community not found");
    this.name = "GamificationCommunityNotFoundError";
  }
}

export class GamificationValidationError extends GamificationError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly GamificationValidationIssue[]) {
    super("gamification input is invalid");
    this.name = "GamificationValidationError";
  }
}
