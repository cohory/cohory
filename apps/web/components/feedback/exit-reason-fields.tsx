"use client";

import { Field, Select, Textarea } from "@cohory/ui";

import {
  exitReasonLabels,
  exitReasonValues,
  isExitReason,
  type ExitReason,
} from "../../lib/feedback/exit-reasons";

export interface ExitReasonValue {
  readonly reason: ExitReason | null;
  readonly comment: string;
}

export const noExitReason: ExitReasonValue = { reason: null, comment: "" };

export function exitAnswer(value: ExitReasonValue): ExitReasonValue | undefined {
  return value.reason === null && value.comment.trim() === "" ? undefined : value;
}

export function ExitReasonFields({
  question,
  value,
  onChange,
  disabled = false,
}: {
  question: string;
  value: ExitReasonValue;
  onChange(value: ExitReasonValue): void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-text">{question} (optional)</legend>
      <p className="text-sm text-text-muted">
        Only the Cohory team reads this, and it does not change what happens next.
      </p>
      <Field label="Reason">
        {(control) => (
          <Select
            {...control}
            name="exitReason"
            value={value.reason ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                reason: isExitReason(event.target.value) ? event.target.value : null,
              })
            }
          >
            <option value="">Choose a reason</option>
            {exitReasonValues.map((reason) => (
              <option key={reason} value={reason}>
                {exitReasonLabels[reason]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Anything else to tell us?">
        {(control) => (
          <Textarea
            {...control}
            name="exitComment"
            rows={2}
            maxLength={1000}
            value={value.comment}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, comment: event.target.value })}
          />
        )}
      </Field>
    </fieldset>
  );
}
