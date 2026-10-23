export type MembersErrorCode =
  "not_found" | "validation_failed" | "username_taken" | "username_reserved";

export interface MembersValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class MembersError extends Error {
  abstract readonly code: MembersErrorCode;
}

export class MemberNotFoundError extends MembersError {
  readonly code = "not_found";

  constructor() {
    super("member not found");
    this.name = "MemberNotFoundError";
  }
}

export class MembersValidationError extends MembersError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly MembersValidationIssue[]) {
    super("members input is invalid");
    this.name = "MembersValidationError";
  }
}

export class UsernameTakenError extends MembersError {
  readonly code = "username_taken";

  constructor(readonly username: string) {
    super(`username ${username} is taken`);
    this.name = "UsernameTakenError";
  }
}

export class UsernameReservedError extends MembersError {
  readonly code = "username_reserved";

  constructor(readonly username: string) {
    super(`username ${username} is reserved`);
    this.name = "UsernameReservedError";
  }
}
