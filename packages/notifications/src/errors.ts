export interface NotificationValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class NotificationValidationError extends Error {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly NotificationValidationIssue[]) {
    super("notification input is invalid");
    this.name = "NotificationValidationError";
  }
}
