"use client";

import { Alert, AlertDescription, AlertTitle, Button, formatBillingDate } from "@cohory/ui";
import { useState, useTransition } from "react";

import { startCheckoutAction } from "../../lib/payments/actions";

export function ResubscribePrompt({
  slug,
  endsAt,
  interval,
}: {
  slug: string;
  endsAt: Date;
  interval: "month" | "year";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Alert variant="warning" className="max-w-xl">
      <AlertTitle>Your current subscription ends on {formatBillingDate(endsAt)}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          Subscribe again to keep your access. Your new subscription starts with a free period until
          then, so you aren&apos;t charged twice.
        </span>
        {error ? (
          <span role="alert" className="text-danger">
            {error}
          </span>
        ) : null}
        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startCheckoutAction({ slug, interval });
              setError(result.message);
            })
          }
        >
          {pending ? "Opening checkout…" : "Subscribe again"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
