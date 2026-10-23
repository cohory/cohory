export type CalendarErrorCode = "not_found" | "validation_failed";

export interface CalendarValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class CalendarError extends Error {
  abstract readonly code: CalendarErrorCode;
}

export class CalendarNotFoundError extends CalendarError {
  readonly code = "not_found";

  constructor(readonly subject: "community" | "event" | "occurrence" = "event") {
    super(`${subject} not found`);
    this.name = "CalendarNotFoundError";
  }
}

export class CalendarValidationError extends CalendarError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly CalendarValidationIssue[]) {
    super("calendar input is invalid");
    this.name = "CalendarValidationError";
  }
}
