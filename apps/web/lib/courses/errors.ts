import { CoursesValidationError } from "@cohory/courses";
import { z } from "zod";

import { actionFailure } from "../posts/errors";

export type CourseFieldErrors = Record<string, string>;

export type CourseActionFailure = { ok: false; message: string; fieldErrors?: CourseFieldErrors };

export type CourseActionResult<T> = { ok: true; data: T } | CourseActionFailure;

function withFieldErrors(
  issues: readonly { path: string; message: string }[],
): CourseActionFailure {
  const fieldErrors: CourseFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.split(".").at(-1);
    if (field) fieldErrors[field] ??= issue.message;
  }
  return {
    ok: false,
    message: issues[0]?.message ?? "Check what you entered and try again.",
    fieldErrors,
  };
}

export function courseActionFailure(error: unknown): CourseActionFailure | null {
  if (error instanceof CoursesValidationError) {
    return withFieldErrors(error.issues);
  }
  if (error instanceof z.ZodError) {
    return withFieldErrors(
      error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return actionFailure(error);
}
