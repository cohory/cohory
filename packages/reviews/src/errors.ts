export type ReviewsErrorCode =
  | "not_found"
  | "validation_failed"
  | "reviews_disabled"
  | "not_eligible"
  | "already_reviewed"
  | "reply_exists"
  | "not_reported";

export interface ReviewsValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class ReviewsError extends Error {
  abstract readonly code: ReviewsErrorCode;
}

export class ReviewNotFoundError extends ReviewsError {
  readonly code = "not_found";

  constructor() {
    super("review not found");
    this.name = "ReviewNotFoundError";
  }
}

export class ReviewsValidationError extends ReviewsError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly ReviewsValidationIssue[]) {
    super("review input is invalid");
    this.name = "ReviewsValidationError";
  }
}

export class ReviewsDisabledError extends ReviewsError {
  readonly code = "reviews_disabled";

  constructor() {
    super("reviews are turned off");
    this.name = "ReviewsDisabledError";
  }
}

export class NotEligibleError extends ReviewsError {
  readonly code = "not_eligible";

  constructor(readonly userMessage: string) {
    super("not eligible to review");
    this.name = "NotEligibleError";
  }
}

export class AlreadyReviewedError extends ReviewsError {
  readonly code = "already_reviewed";

  constructor() {
    super("member already reviewed this community");
    this.name = "AlreadyReviewedError";
  }
}

export class ReplyExistsError extends ReviewsError {
  readonly code = "reply_exists";

  constructor() {
    super("review already has a reply");
    this.name = "ReplyExistsError";
  }
}

export class NotReportedError extends ReviewsError {
  readonly code = "not_reported";

  constructor() {
    super("review has no open report");
    this.name = "NotReportedError";
  }
}
