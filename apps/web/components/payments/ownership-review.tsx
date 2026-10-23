"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@cohory/ui";
import { useTransition, useState } from "react";

import { keepPaymentAccountAction } from "../../lib/payments/actions";

export interface PaymentOwnershipReview {
  readonly previousOwnerName: string | null;
  readonly paying: number;
}

function payingMembers(count: number): string {
  return count === 1 ? "1 paying member is" : `${count} paying members are`;
}

export function OwnershipReview({
  slug,
  review,
  providerName,
  onConnectOwn,
  onChanged,
}: {
  slug: string;
  review: PaymentOwnershipReview;
  providerName: string;
  onConnectOwn(): void;
  onChanged(): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const previous = review.previousOwnerName ?? "The previous owner";

  function keep() {
    setError(null);
    startTransition(async () => {
      const result = await keepPaymentAccountAction({ slug });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <Alert variant="warning">
      <AlertTitle>Choose a {providerName} account for payments</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>
          {previous} connected this {providerName} account. New checkouts are paused until you
          choose.
          {review.paying > 0
            ? ` ${payingMembers(review.paying)} billed on it. Connecting your own account does not move their subscriptions.`
            : ""}
        </span>
        {error ? (
          <span role="alert" className="text-danger">
            {error}
          </span>
        ) : null}
        <span className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={keep}
          >
            The previous owner&apos;s {providerName} account keeps receiving payments
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={onConnectOwn}
          >
            Connect my own {providerName} account
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
