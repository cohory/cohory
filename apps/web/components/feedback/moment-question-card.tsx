"use client";

import { Button, Card, CardContent, Field, Textarea } from "@cohory/ui";
import { XIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { respondToMomentAction, type MomentResponseActionInput } from "../../lib/feedback/actions";

export interface MomentQuestionCardProps {
  readonly slug: string;
  readonly moment: MomentResponseActionInput["moment"];
  readonly question: string;
  readonly low: string;
  readonly high: string;
  readonly followUp: string;
  readonly commentMaxLength: number;
}

const scores = [1, 2, 3, 4, 5] as const;

type Outcome = MomentResponseActionInput["outcome"];

export function MomentQuestionCard({
  slug,
  moment,
  question,
  low,
  high,
  followUp,
  commentMaxLength,
}: MomentQuestionCardProps) {
  const headingId = useId();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"open" | "thanks" | "closed">("open");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(outcome: Outcome, optOut = false) {
    setError(null);
    startTransition(async () => {
      const result = await respondToMomentAction({
        slug,
        moment,
        outcome,
        optOut,
        ...(outcome === "answered" ? { score, comment } : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setState(outcome === "answered" ? "thanks" : "closed");
    });
  }

  if (state === "closed") {
    return null;
  }
  if (state === "thanks") {
    return (
      <Card role="status">
        <CardContent className="text-sm text-text">Thanks. We read every answer.</CardContent>
      </Card>
    );
  }

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-base font-medium text-text">
            {question}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            disabled={pending}
            onClick={() => send("dismissed")}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">
            Ease from 1, {low.toLowerCase()}, to 5, {high.toLowerCase()}
          </legend>
          <div className="grid grid-cols-5 gap-2">
            {scores.map((value) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border text-sm font-medium text-text has-checked:border-accent has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  type="radio"
                  name={`${headingId}-score`}
                  value={value}
                  className="sr-only"
                  checked={score === value}
                  disabled={pending}
                  onChange={() => setScore(value)}
                />
                {value}
                <span className="sr-only">
                  {value === 1 ? `, ${low}` : value === 5 ? `, ${high}` : ""}
                </span>
              </label>
            ))}
          </div>
          <div aria-hidden="true" className="flex justify-between text-xs text-text-muted">
            <span>{low}</span>
            <span>{high}</span>
          </div>
        </fieldset>
        <Field label={`${followUp} (optional)`}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={commentMaxLength}
              value={comment}
              disabled={pending}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={pending || score === null}
            onClick={() => send("answered")}
          >
            {pending ? "Sending…" : "Send"}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => send("snoozed")}>
            Not now
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={() => send("dismissed", true)}
            className="ml-auto min-h-11 rounded-sm text-sm text-text-muted underline-offset-4 outline-none hover:text-text hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Don&apos;t ask me again
          </button>
        </div>
        <p className="text-xs text-text-muted">
          Only the Cohory team reads your answer. You can turn these questions back on in Account,
          Notifications.
        </p>
      </CardContent>
    </Card>
  );
}
