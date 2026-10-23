"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Field,
  MembershipStatus,
  PricingCard,
  Textarea,
  formatMoney,
  type BillingInterval,
  type PricingCardPlan,
} from "@cohory/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import {
  openBillingPortalAction,
  resumeMembershipAction,
  startCheckoutAction,
  switchToYearlyAction,
} from "../../lib/payments/actions";
import type { MembershipPageState } from "../../lib/payments/views";
import { SmallPrint, type CheckoutTerms } from "./checkout-small-print";

const defaultFeatures = [
  "Posts and discussions in the community",
  "Courses in the Classroom",
  "Events on the Calendar",
];

const linkClass =
  "rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export interface JoinQuestionField {
  readonly text: string;
  readonly required: boolean;
}

export function MembershipPanel({
  slug,
  plan,
  state,
  providerName,
  features = defaultFeatures,
  archived = false,
  billingClosed = null,
  questions = [],
  checkout,
}: {
  slug: string;
  checkout: CheckoutTerms;
  plan: PricingCardPlan | null;
  providerName: string;
  features?: readonly string[];
  archived?: boolean;
  billingClosed?: string | null;
  questions?: readonly JoinQuestionField[];
  state: Extract<MembershipPageState, { kind: "buy" | "subscribed" | "free_community" }>;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [missing, setMissing] = useState<readonly number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const asking = state.kind === "buy" && state.purchasable && !archived && questions.length > 0;

  function buy(chosen: BillingInterval) {
    setError(null);
    const unanswered = asking
      ? questions.flatMap((question, index) =>
          question.required && !(answers[index] ?? "").trim() ? [index] : [],
        )
      : [];
    setMissing(unanswered);
    if (unanswered.length > 0) {
      return;
    }
    startTransition(async () => {
      const result = await startCheckoutAction({
        slug,
        interval: chosen,
        answers: asking ? answers : [],
      });
      setError(result.message);
    });
  }

  function manageBilling() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortalAction({ slug });
      setError(result.message);
    });
  }

  function resume() {
    setError(null);
    startTransition(async () => {
      const result = await resumeMembershipAction({ slug });
      setError(result.ok ? null : result.message);
    });
  }

  function switchToYearly() {
    setError(null);
    startTransition(async () => {
      const result = await switchToYearlyAction({ slug });
      setError(result.message);
    });
  }

  if (state.kind === "subscribed") {
    const suggestion = state.yearlySuggestion;
    return (
      <MembershipStatus
        kind={state.status}
        interval={state.interval}
        periodEnd={state.periodEnd}
        planName={plan?.name ?? null}
        price={state.price}
        canManageBilling={state.canManageBilling}
        providerName={providerName}
        onManageBilling={manageBilling}
        onResume={resume}
        pending={pending}
        error={error}
        className="max-w-xl"
      >
        {suggestion ? (
          <p className="text-sm text-text-muted">
            Switch to yearly: {formatMoney(suggestion.annualPriceMinor, suggestion.currency)} a
            year, {formatMoney(suggestion.savingMinor, suggestion.currency)} less than monthly.{" "}
            <button type="button" className={linkClass} disabled={pending} onClick={switchToYearly}>
              Switch to yearly
            </button>
          </p>
        ) : null}
        {state.canCancel ? (
          <Link href={`/c/${slug}/membership/cancel`} className={`self-start text-sm ${linkClass}`}>
            Cancel membership
          </Link>
        ) : null}
      </MembershipStatus>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {billingClosed ? (
        <Alert variant="info" className="max-w-xl">
          <AlertTitle>Your paid access ended</AlertTitle>
          <AlertDescription className="text-text">{billingClosed}</AlertDescription>
        </Alert>
      ) : null}
      {asking ? (
        <section
          aria-labelledby="join-questions-heading"
          className="flex max-w-md flex-col gap-4 rounded-md border border-border p-4"
        >
          <div className="flex flex-col gap-1">
            <h3 id="join-questions-heading" className="text-base font-medium text-text">
              A few questions before you pay
            </h3>
            <p className="text-sm text-text-muted">Only the community team sees your answers.</p>
          </div>
          {questions.map((question, index) => (
            <Field
              key={question.text}
              label={question.required ? question.text : `${question.text} (optional)`}
              error={missing.includes(index) ? "Answer this question to join." : undefined}
            >
              {(control) => (
                <Textarea
                  {...control}
                  name={`answer-${index}`}
                  rows={3}
                  maxLength={1000}
                  required={question.required}
                  value={answers[index] ?? ""}
                  disabled={pending}
                  onChange={(event) =>
                    setAnswers((current) =>
                      current.map((answer, at) => (at === index ? event.target.value : answer)),
                    )
                  }
                />
              )}
            </Field>
          ))}
        </section>
      ) : null}
      <PricingCard
        plan={state.kind === "buy" ? plan : null}
        interval={interval}
        onIntervalChange={setInterval}
        state={state.kind === "buy" && (archived || !state.purchasable) ? "disabled" : "default"}
        disabledReason={
          archived
            ? "This community is archived, so new memberships are closed."
            : "The creator hasn't finished setting up payments. Try again later."
        }
        features={[...features]}
        onBuy={buy}
        pending={pending}
        footer={
          state.kind === "buy" ? (
            <SmallPrint providerName={providerName} checkout={checkout} />
          ) : undefined
        }
        className="max-w-md"
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
