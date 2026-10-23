"use client";

import { Button, Field, Select, Textarea, formatMoney } from "@cohory/ui";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import {
  cancelMembershipAction,
  pauseMembershipAction,
  switchToYearlyAction,
} from "../../lib/payments/actions";
import { cancelReasons, type CancelReason } from "../../lib/payments/cancel-reasons";

type Choice = "yearly" | "pause" | "cancel";

const reasonLabels: Record<CancelReason, string> = {
  too_expensive: "It costs too much",
  unused: "I don't use it enough",
  missing_features: "Something I need is missing",
  low_quality: "The content isn't what I expected",
  customer_service: "I had a problem with support",
  switched_service: "I'm moving to something else",
  too_complex: "It's hard to use",
  other: "Another reason",
};

const pauseMonths = [1, 2, 3] as const;

export interface CancelMembershipProps {
  readonly slug: string;
  readonly communityName: string;
  readonly yearly: {
    readonly annualPriceMinor: number;
    readonly savingMinor: number;
    readonly currency: string;
  } | null;
  readonly canPause: boolean;
}

function isReason(value: string): value is CancelReason {
  return (cancelReasons as readonly string[]).includes(value);
}

export function CancelMembership({ slug, communityName, yearly, canPause }: CancelMembershipProps) {
  const [reason, setReason] = useState<CancelReason | "">("");
  const [comment, setComment] = useState("");
  const [months, setMonths] = useState<1 | 2 | 3>(1);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(choice: Choice, action: () => Promise<{ ok: false; message: string }>) {
    setError(null);
    setChosen(choice);
    startTransition(async () => {
      const result = await action();
      setError(result.message);
    });
  }

  function spinner(choice: Choice) {
    return pending && chosen === choice ? (
      <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
    ) : null;
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section aria-labelledby="cancel-reason-heading" className="flex flex-col gap-4">
        <h3 id="cancel-reason-heading" className="text-base font-medium text-text">
          Why are you leaving? (optional)
        </h3>
        <Field label="Reason">
          {(control) => (
            <Select
              {...control}
              name="feedback"
              value={reason}
              disabled={pending}
              onChange={(event) =>
                setReason(isReason(event.target.value) ? event.target.value : "")
              }
            >
              <option value="">Choose a reason</option>
              {cancelReasons.map((value) => (
                <option key={value} value={value}>
                  {reasonLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Anything else to tell the creator?"
          description={`The team behind ${communityName} sees your answer in Stripe.`}
        >
          {(control) => (
            <Textarea
              {...control}
              name="comment"
              rows={3}
              maxLength={500}
              value={comment}
              disabled={pending}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
      </section>
      <section aria-label="Your choices" className="grid gap-3 sm:grid-cols-2">
        {yearly ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4">
            <p className="text-sm text-text">
              Pay {formatMoney(yearly.annualPriceMinor, yearly.currency)} a year and save{" "}
              {formatMoney(yearly.savingMinor, yearly.currency)}.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto min-h-11"
              disabled={pending}
              onClick={() => run("yearly", () => switchToYearlyAction({ slug }))}
            >
              {spinner("yearly")}
              Switch to yearly and save {formatMoney(yearly.savingMinor, yearly.currency)}
            </Button>
          </div>
        ) : null}
        {canPause ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4">
            <Field label="Pause payments for">
              {(control) => (
                <Select
                  {...control}
                  name="months"
                  value={String(months)}
                  disabled={pending}
                  onChange={(event) => {
                    const next = pauseMonths.find((value) => String(value) === event.target.value);
                    if (next) setMonths(next);
                  }}
                >
                  {pauseMonths.map((value) => (
                    <option key={value} value={value}>
                      {value === 1 ? "1 month" : `${value} months`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto min-h-11"
              disabled={pending}
              onClick={() => run("pause", () => pauseMembershipAction({ slug, months }))}
            >
              {spinner("pause")}
              Pause payments
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <p className="text-sm text-text">
            Stripe asks you to confirm. Your membership ends when the period you paid for ends.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-auto min-h-11"
            disabled={pending}
            onClick={() =>
              run("cancel", () =>
                cancelMembershipAction({ slug, feedback: reason === "" ? null : reason, comment }),
              )
            }
          >
            {spinner("cancel")}
            Cancel membership
          </Button>
        </div>
      </section>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
