export type PostsErrorCode =
  | "not_found"
  | "validation_failed"
  | "pin_limit_reached"
  | "invalid_parent"
  | "category_limit_reached"
  | "post_not_scheduled"
  | "member_email_too_soon";

export abstract class PostsError extends Error {
  abstract readonly code: PostsErrorCode;
}

export class PostsCommunityNotFoundError extends PostsError {
  readonly code = "not_found";

  constructor() {
    super("community not found");
    this.name = "PostsCommunityNotFoundError";
  }
}

export class PostNotFoundError extends PostsError {
  readonly code = "not_found";

  constructor() {
    super("post not found");
    this.name = "PostNotFoundError";
  }
}

export class CommentNotFoundError extends PostsError {
  readonly code = "not_found";

  constructor() {
    super("comment not found");
    this.name = "CommentNotFoundError";
  }
}

export interface PostsValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class PostValidationError extends PostsError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly PostsValidationIssue[]) {
    super("post input is invalid");
    this.name = "PostValidationError";
  }
}

export class PinLimitError extends PostsError {
  readonly code = "pin_limit_reached";

  constructor(readonly limit: number) {
    super(`a community can pin up to ${limit} posts`);
    this.name = "PinLimitError";
  }
}

export class InvalidParentCommentError extends PostsError {
  readonly code = "invalid_parent";

  constructor() {
    super("replies must answer a top level comment on the same post");
    this.name = "InvalidParentCommentError";
  }
}

export class CategoryNotFoundError extends PostsError {
  readonly code = "not_found";

  constructor() {
    super("category not found");
    this.name = "CategoryNotFoundError";
  }
}

export class CategoryLimitError extends PostsError {
  readonly code = "category_limit_reached";

  constructor(readonly limit: number) {
    super(`a community can have at most ${limit} categories`);
    this.name = "CategoryLimitError";
  }
}

export class PostNotScheduledError extends PostsError {
  readonly code = "post_not_scheduled";

  constructor() {
    super("post is not scheduled");
    this.name = "PostNotScheduledError";
  }
}

export class MemberEmailTooSoonError extends PostsError {
  readonly code = "member_email_too_soon";

  constructor(readonly nextAvailableAt: Date) {
    super("a post was already emailed to all members in the last 24 hours");
    this.name = "MemberEmailTooSoonError";
  }
}
