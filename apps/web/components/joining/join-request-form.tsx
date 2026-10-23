"use client";

import { Button, Field, Textarea } from "@cohory/ui";
import { useActionState } from "react";

import { requestToJoinAction, type MembershipActionState } from "../../app/c/[slug]/actions";

const initialState: MembershipActionState = { status: "idle" };

export interface JoinQuestionView {
  readonly text: string;
  readonly required: boolean;
}

export function JoinRequestForm({
  slug,
  questions,
  submitLabel = "Request to join",
}: {
  slug: string;
  questions: readonly JoinQuestionView[];
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState(
    requestToJoinAction.bind(null, slug),
    initialState,
  );

  return (
    <form
      action={action}
      className="flex w-full flex-col gap-4 md:w-auto"
      aria-label="Request to join"
    >
      {questions.map((question, index) => (
        <Field
          key={question.text}
          label={question.required ? question.text : `${question.text} (optional)`}
        >
          {(control) => (
            <Textarea
              {...control}
              name={`answer-${index}`}
              rows={3}
              maxLength={1000}
              required={question.required}
            />
          )}
        </Field>
      ))}
      {questions.length > 0 ? (
        <p className="text-sm text-text-muted">Only the community team sees your answers.</p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11 w-full md:w-auto md:self-start">
        {pending ? "Sending request…" : submitLabel}
      </Button>
    </form>
  );
}
