"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { IntervalToggle } from "./interval-toggle";
import { formatMoney, formatMoneySpoken, intervalNoun, type BillingInterval } from "./money";

interface PricingCardPlan {
  name: string;
  currency: string;
  monthlyPriceMinor: number;
  annualPriceMinor: number | null;
}

type PricingCardState = "default" | "current" | "past_due" | "disabled";

interface PricingCardProps {
  plan: PricingCardPlan | null;
  interval: BillingInterval;
  onIntervalChange(interval: BillingInterval): void;
  state?: PricingCardState;
  features?: string[];
  onBuy?(interval: BillingInterval): void;
  onManageBilling?(): void;
  pending?: boolean;
  disabledReason?: ReactNode;
  footer?: ReactNode;
  locale?: string;
  className?: string;
}

function priceFor(plan: PricingCardPlan, interval: BillingInterval): number {
  return interval === "year" && plan.annualPriceMinor !== null
    ? plan.annualPriceMinor
    : plan.monthlyPriceMinor;
}

function yearlySavingMinor(plan: PricingCardPlan): number | null {
  if (plan.annualPriceMinor === null) {
    return null;
  }
  const saving = plan.monthlyPriceMinor * 12 - plan.annualPriceMinor;
  return saving > 0 ? saving : null;
}

function PricingCard({
  plan,
  interval,
  onIntervalChange,
  state = "default",
  features = [],
  onBuy,
  onManageBilling,
  pending = false,
  disabledReason,
  footer,
  locale,
  className,
}: PricingCardProps) {
  const effective: BillingInterval =
    plan && interval === "year" && plan.annualPriceMinor !== null ? "year" : "month";
  const amount = plan ? priceFor(plan, effective) : 0;
  const price = plan ? formatMoney(amount, plan.currency, locale) : "Free";
  const noun = intervalNoun(effective);
  const saving = plan && effective === "year" ? yearlySavingMinor(plan) : null;

  return (
    <section
      data-slot="pricing-card"
      data-state={state}
      aria-label={plan ? plan.name : "Free membership"}
      className={cn(
        "flex flex-col gap-5 rounded-(--card-radius) border border-border bg-surface p-6 text-text shadow-(--card-shadow)",
        state === "current" && "border-accent bg-accent-muted",
        state === "past_due" && "border-warning",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{plan ? plan.name : "Membership"}</h2>
        {state === "current" ? <Badge>Your plan</Badge> : null}
        {state === "past_due" ? <Badge variant="warning">Payment failed</Badge> : null}
      </div>
      {plan && plan.annualPriceMinor !== null && state !== "current" && state !== "past_due" ? (
        <IntervalToggle
          value={effective}
          onChange={onIntervalChange}
          disabled={pending}
          className="self-start"
        />
      ) : null}
      {plan ? (
        <p className="flex items-baseline gap-1">
          <span className="sr-only">
            {`${formatMoneySpoken(amount, plan.currency, locale)} per ${noun}`}
          </span>
          <span aria-hidden="true" className="text-3xl font-semibold tabular-nums">
            {price}
          </span>
          <span aria-hidden="true" className="text-sm text-text-muted">
            per {noun}
          </span>
        </p>
      ) : (
        <p className="text-3xl font-semibold">Free</p>
      )}
      {plan && saving !== null ? (
        <p className="-mt-3 text-sm font-medium text-text">
          Save {formatMoney(saving, plan.currency, locale)} a year
        </p>
      ) : null}
      {features.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
      {state === "past_due" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            Your last payment failed. Update your payment method to keep your access.
          </p>
          {onManageBilling ? (
            <Button
              type="button"
              className="min-h-11 self-start"
              disabled={pending}
              onClick={onManageBilling}
            >
              {pending ? <Loader2Icon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Manage billing
            </Button>
          ) : null}
        </div>
      ) : null}
      {plan && state === "default" && onBuy ? (
        <Button
          type="button"
          size="lg"
          className="min-h-11 w-full"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => onBuy(effective)}
        >
          {pending ? (
            <>
              <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
              Opening checkout
            </>
          ) : (
            `Join for ${price}/${noun}`
          )}
        </Button>
      ) : null}
      {plan && state === "disabled" ? (
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" className="min-h-11 w-full" disabled>
            Not available
          </Button>
          {disabledReason ? <p className="text-sm text-text-muted">{disabledReason}</p> : null}
        </div>
      ) : null}
      {footer ? <div className="text-xs text-text-muted">{footer}</div> : null}
    </section>
  );
}

export {
  PricingCard,
  yearlySavingMinor,
  type PricingCardPlan,
  type PricingCardProps,
  type PricingCardState,
};
