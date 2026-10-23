"use client";

import { CreditCardIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";

type PlatformBillingPending = "email" | "card" | null;

interface PlatformBillingSettingsProps {
  billingEmail: string | null;
  ownerEmail: string | null;
  paymentMethodLabel: string | null;
  canManage: boolean;
  pending?: PlatformBillingPending;
  error?: string | null;
  onSaveEmail?: (email: string) => void;
  onAddCard?: () => void;
  className?: string;
}

function PlatformBillingSettings({
  billingEmail,
  ownerEmail,
  paymentMethodLabel,
  canManage,
  pending = null,
  error = null,
  onSaveEmail,
  onAddCard,
  className,
}: PlatformBillingSettingsProps) {
  const [email, setEmail] = useState(billingEmail ?? "");
  const [missing, setMissing] = useState(false);
  const sendTo = billingEmail ?? ownerEmail;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    setMissing(trimmed === "");
    if (trimmed !== "") onSaveEmail?.(trimmed);
  }

  return (
    <div data-slot="platform-billing-settings" className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <CreditCardIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text">{paymentMethodLabel ?? "No card saved"}</p>
            <p className="text-sm text-text-muted">
              {paymentMethodLabel
                ? "Invoices are charged to this card automatically."
                : "Without a card we email each invoice and you pay it on a Stripe page."}
            </p>
          </div>
        </div>
        {canManage ? (
          <Button
            type="button"
            className="self-start"
            variant={paymentMethodLabel ? "secondary" : "primary"}
            disabled={pending !== null}
            onClick={onAddCard}
          >
            {pending === "card"
              ? "Opening Stripe…"
              : paymentMethodLabel
                ? "Replace card"
                : "Add a card"}
          </Button>
        ) : null}
      </div>
      {canManage ? (
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <Field
            label="Billing email"
            description={
              sendTo ? `Invoices go to ${sendTo}.` : "Invoices go to the community owner."
            }
            error={missing ? "Enter a billing email, like name@example.com." : (error ?? undefined)}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={pending !== null}
          >
            {pending === "email" ? "Saving…" : "Save email"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-text-muted">Only the owner can change billing details.</p>
      )}
    </div>
  );
}

export { PlatformBillingSettings, type PlatformBillingPending, type PlatformBillingSettingsProps };
