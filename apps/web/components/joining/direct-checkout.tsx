"use client";

import { Button, type BillingInterval } from "@cohory/ui";
import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { startCheckoutAction } from "../../lib/payments/actions";

const yearlyLink =
  "min-h-11 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function DirectCheckout({
  slug,
  label,
  yearlyLabel,
}: {
  slug: string;
  label: string;
  yearlyLabel: string | null;
}) {
  const [chosen, setChosen] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buy(interval: BillingInterval) {
    setError(null);
    setChosen(interval);
    startTransition(async () => {
      const result = await startCheckoutAction({ slug, interval, answers: [] });
      setError(result.message);
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 md:w-auto">
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 md:w-auto">
        <Button
          type="button"
          className="min-h-11 w-full md:w-auto"
          disabled={pending}
          aria-busy={(pending && chosen === "month") || undefined}
          onClick={() => buy("month")}
        >
          {pending && chosen === "month" ? (
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
          {label}
        </Button>
        {yearlyLabel ? (
          <button
            type="button"
            className={yearlyLink}
            disabled={pending}
            aria-busy={(pending && chosen === "year") || undefined}
            onClick={() => buy("year")}
          >
            {yearlyLabel}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
