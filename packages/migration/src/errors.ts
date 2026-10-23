export type MigrationErrorCode =
  | "not_found"
  | "validation_failed"
  | "invalid_archive"
  | "unsupported_schema_version"
  | "checksum_mismatch"
  | "archive_too_large"
  | "community_not_empty"
  | "job_not_ready"
  | "job_in_progress"
  | "invalid_csv"
  | "daily_email_limit";

export interface MigrationIssue {
  readonly path: string;
  readonly message: string;
}

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly issues: readonly MigrationIssue[] = [],
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export class MigrationNotFoundError extends MigrationError {
  constructor(subject: "community" | "job" | "file" | "member" = "job") {
    super("not_found", `${subject} not found`);
    this.name = "MigrationNotFoundError";
  }
}

export function invalidArchive(message: string, path = "archive"): MigrationError {
  return new MigrationError("invalid_archive", message, [{ path, message }]);
}
