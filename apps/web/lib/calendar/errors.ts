import { CalendarValidationError } from "@cohory/calendar";
import type { EventFormErrors, EventFormValue } from "@cohory/ui";
import { z } from "zod";

import { actionFailure } from "../posts/errors";

export type CalendarActionResult<T> =
  { ok: true; data: T } | { ok: false; message: string; fieldErrors?: EventFormErrors };

const formFields: Record<string, keyof EventFormValue> = {
  title: "title",
  description: "description",
  date: "date",
  time: "time",
  startsAtLocal: "date",
  timeZone: "timeZone",
  durationMinutes: "durationMinutes",
  recurrence: "recurrenceUntil",
  recurrenceUntil: "recurrenceUntil",
  location: "location",
};

export function toFieldErrors(
  issues: readonly { path: string; message: string }[],
): EventFormErrors {
  const errors: EventFormErrors = {};
  for (const issue of issues) {
    const key = issue.path.split(".").at(-1) ?? "";
    const field = formFields[key] ?? "form";
    errors[field] ??= issue.message;
  }
  return errors;
}

function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function calendarActionFailure(
  error: unknown,
): { ok: false; message: string; fieldErrors?: EventFormErrors } | null {
  const issues =
    error instanceof z.ZodError
      ? zodIssues(error)
      : error instanceof CalendarValidationError
        ? error.issues
        : null;
  if (issues) {
    return {
      ok: false,
      message: issues[0]?.message ?? "Check what you entered and try again.",
      fieldErrors: toFieldErrors(issues),
    };
  }
  return actionFailure(error);
}
