"use client";

import { formatMinorPlain, planPriceIssues, stripeCurrency } from "@cohory/payments/currency";
import { computeApplicationFee } from "@cohory/payments/fee";
import { Loader2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useFocusFirstError } from "../lib/use-focus-first-error";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Select } from "../primitives/select";
import { formatMoney, parseMoneyInput, toMoneyInput } from "./money";

const defaultMaxPriceMinor = 99_999_999;

interface PlanFormValue {
  currency: string;
  monthlyPrice: string;
  annualPrice: string;
  annualEnabled: boolean;
}

interface PlanFormSubmission {
  currency: string;
  monthlyPriceMinor: number;
  annualPriceMinor: number | null;
}

type PlanFormErrors = Partial<Record<"currency" | "monthlyPrice" | "annualPrice", string>>;

type PlanFormValidation =
  { ok: true; data: PlanFormSubmission } | { ok: false; errors: PlanFormErrors };

function minimumHint(currency: string): string | undefined {
  const entry = stripeCurrency(currency);
  return entry ? `At least ${formatMinorPlain(entry.minimumChargeMinor, entry)}.` : undefined;
}

function checkPrice(
  text: string,
  currency: string,
  maxPriceMinor: number,
  missing: string,
): { minor: number } | { error: string } {
  const minor = parseMoneyInput(text, currency);
  if (minor === null) {
    return { error: missing };
  }
  if (minor < 1) {
    return { error: "Enter a price above zero." };
  }
  if (minor > maxPriceMinor) {
    return { error: `Enter at most ${formatMoney(maxPriceMinor, currency)}.` };
  }
  return { minor };
}

function validatePlanForm(
  value: PlanFormValue,
  maxPriceMinor = defaultMaxPriceMinor,
): PlanFormValidation {
  const currency = value.currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    return { ok: false, errors: { currency: "Choose a currency." } };
  }
  const errors: PlanFormErrors = {};
  const monthly = checkPrice(
    value.monthlyPrice,
    currency,
    maxPriceMinor,
    "Enter a monthly price, like 29.00.",
  );
  if ("error" in monthly) {
    errors.monthlyPrice = monthly.error;
  }
  const annual = value.annualEnabled
    ? checkPrice(
        value.annualPrice,
        currency,
        maxPriceMinor,
        "Enter a yearly price, like 290.00, or remove it.",
      )
    : null;
  if (annual && "error" in annual) {
    errors.annualPrice = annual.error;
  }
  if ("error" in monthly || (annual && "error" in annual)) {
    return { ok: false, errors };
  }
  const data = {
    currency,
    monthlyPriceMinor: monthly.minor,
    annualPriceMinor: annual && "minor" in annual ? annual.minor : null,
  };
  for (const issue of planPriceIssues(data)) {
    if (issue.path === "currency") errors.currency = issue.message;
    if (issue.path === "monthlyPriceMinor") errors.monthlyPrice = issue.message;
    if (issue.path === "annualPriceMinor") errors.annualPrice = issue.message;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data };
}

function takeHomeLine(
  value: PlanFormValue,
  platformFeeBps: number,
  providerName: string,
): string | null {
  const minor = parseMoneyInput(value.monthlyPrice, value.currency);
  if (minor === null || minor < 1 || minor > defaultMaxPriceMinor) {
    return null;
  }
  const fee = computeApplicationFee(minor, platformFeeBps);
  const platform =
    fee === 0 ? "No platform fee." : `Platform fee ${formatMoney(fee, value.currency)}.`;
  return `Member pays ${formatMoney(minor, value.currency)}. ${platform} ${providerName} fee varies by card and country. You get the rest.`;
}

interface PlanFormProps {
  currencies: readonly string[];
  onSubmit(value: PlanFormSubmission): void;
  initial?: PlanFormSubmission | null;
  currencyLocked?: boolean;
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  maxPriceMinor?: number;
  platformFeeBps?: number;
  providerName?: string;
  priceChangeHint?: boolean;
  submitLabel?: string;
  className?: string;
}

function initialValue(initial: PlanFormSubmission | null, fallback: string): PlanFormValue {
  if (!initial) {
    return { currency: fallback, monthlyPrice: "", annualPrice: "", annualEnabled: false };
  }
  return {
    currency: initial.currency,
    monthlyPrice: toMoneyInput(initial.monthlyPriceMinor, initial.currency),
    annualPrice:
      initial.annualPriceMinor === null
        ? ""
        : toMoneyInput(initial.annualPriceMinor, initial.currency),
    annualEnabled: initial.annualPriceMinor !== null,
  };
}

function planChanged(value: PlanFormValue, initial: PlanFormSubmission | null): boolean {
  if (!initial) return value.monthlyPrice.trim() !== "" || value.annualPrice.trim() !== "";
  const parsed = validatePlanForm(value, Number.MAX_SAFE_INTEGER);
  if (!parsed.ok) return true;
  return (
    parsed.data.currency !== initial.currency ||
    parsed.data.monthlyPriceMinor !== initial.monthlyPriceMinor ||
    parsed.data.annualPriceMinor !== initial.annualPriceMinor
  );
}

function PlanForm({
  currencies,
  onSubmit,
  initial = null,
  currencyLocked = false,
  disabled = false,
  pending = false,
  error,
  maxPriceMinor = defaultMaxPriceMinor,
  platformFeeBps,
  providerName = "Stripe",
  priceChangeHint = false,
  submitLabel = "Save pricing",
  className,
}: PlanFormProps) {
  const [value, setValue] = useState(() => initialValue(initial, currencies[0] ?? "usd"));
  const [errors, setErrors] = useState<PlanFormErrors>({});
  const options = currencies.includes(value.currency)
    ? currencies
    : [value.currency, ...currencies];
  const inert = disabled || pending;
  const formRef = useFocusFirstError<HTMLFormElement>(errors);
  const takeHome =
    platformFeeBps === undefined ? null : takeHomeLine(value, platformFeeBps, providerName);
  useUnsavedChanges(!pending && planChanged(value, initial));

  function update(patch: Partial<PlanFormValue>) {
    setValue((current) => ({ ...current, ...patch }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inert) return;
    const result = validatePlanForm(value, maxPriceMinor);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  return (
    <form
      ref={formRef}
      noValidate
      data-slot="plan-form"
      aria-busy={pending || undefined}
      onSubmit={submit}
      className={cn("flex flex-col gap-5", className)}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Currency"
          description={
            currencyLocked ? "Stop selling memberships to change the currency." : undefined
          }
          error={errors.currency}
        >
          {(control) => (
            <Select
              {...control}
              value={value.currency}
              disabled={inert || currencyLocked}
              onChange={(event) => update({ currency: event.target.value })}
            >
              {options.map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Monthly price"
          description={minimumHint(value.currency)}
          error={errors.monthlyPrice}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              autoComplete="off"
              placeholder="29.00"
              value={value.monthlyPrice}
              disabled={inert}
              onChange={(event) => update({ monthlyPrice: event.target.value })}
            />
          )}
        </Field>
      </div>
      {takeHome ? (
        <p data-slot="plan-take-home" aria-live="polite" className="text-sm text-text-muted">
          {takeHome}
        </p>
      ) : null}
      {priceChangeHint ? (
        <p className="text-sm text-text-muted">
          New price is for new members. Current members keep what they pay.
        </p>
      ) : null}
      {value.annualEnabled ? (
        <div className="flex flex-col gap-2">
          <Field
            label="Yearly price"
            description="Members choose monthly or yearly at checkout."
            error={errors.annualPrice}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                placeholder="290.00"
                value={value.annualPrice}
                disabled={inert}
                onChange={(event) => update({ annualPrice: event.target.value })}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={inert}
            onClick={() => update({ annualEnabled: false, annualPrice: "" })}
          >
            Remove annual price
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-start"
          disabled={inert}
          onClick={() => update({ annualEnabled: true })}
        >
          Add an annual price
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="min-h-11 self-start" disabled={inert}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            Saving
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}

export {
  PlanForm,
  validatePlanForm,
  type PlanFormErrors,
  type PlanFormProps,
  type PlanFormSubmission,
  type PlanFormValue,
};
