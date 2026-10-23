export type CoursesErrorCode = "not_found" | "validation_failed";

export interface CoursesValidationIssue {
  readonly path: string;
  readonly message: string;
}

export abstract class CoursesError extends Error {
  abstract readonly code: CoursesErrorCode;
}

export class CourseNotFoundError extends CoursesError {
  readonly code = "not_found";

  constructor(
    readonly subject:
      | "community"
      | "course"
      | "module"
      | "lesson"
      | "attachment"
      | "agent_version"
      | "agent_task"
      | "agent_file"
      | "agent_download" = "course",
  ) {
    super(`${subject} not found`);
    this.name = "CourseNotFoundError";
  }
}

export class CoursesValidationError extends CoursesError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly CoursesValidationIssue[]) {
    super("course input is invalid");
    this.name = "CoursesValidationError";
  }
}

export class ReorderMismatchError extends CoursesValidationError {
  constructor() {
    super([{ path: "ids", message: "List every item exactly once, in the new order." }]);
    this.name = "ReorderMismatchError";
  }
}
