export type OwnedCommunityReason = "active" | "billing";

export interface OwnedCommunity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly reason: OwnedCommunityReason;
}

export class AccountDeletionBlockedError extends Error {
  readonly code = "account_deletion_blocked";

  constructor(readonly communities: readonly OwnedCommunity[]) {
    super("account owns communities");
    this.name = "AccountDeletionBlockedError";
  }
}

export class AccountConfirmationError extends Error {
  readonly code = "confirmation_mismatch";

  constructor() {
    super("confirmation does not match");
    this.name = "AccountConfirmationError";
  }
}

export class AccountNotFoundError extends Error {
  readonly code = "not_found";

  constructor() {
    super("account not found");
    this.name = "AccountNotFoundError";
  }
}

export class DataExportRateLimitedError extends Error {
  readonly code = "rate_limited";

  constructor(readonly retryAt: Date) {
    super("data export requested too recently");
    this.name = "DataExportRateLimitedError";
  }
}

export class DataExportNotFoundError extends Error {
  readonly code = "not_found";

  constructor() {
    super("data export not found or expired");
    this.name = "DataExportNotFoundError";
  }
}
