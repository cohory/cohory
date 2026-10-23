"use client";

import { PlatformBillingSettings, toast, type PlatformBillingPending } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveBillingEmailAction, startCardSetupAction } from "./actions";

export function BillingPanel({
  slug,
  billingEmail,
  ownerEmail,
  paymentMethodLabel,
  canManage,
  initialError = null,
}: {
  slug: string;
  billingEmail: string | null;
  ownerEmail: string | null;
  paymentMethodLabel: string | null;
  canManage: boolean;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PlatformBillingPending>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [, startTransition] = useTransition();

  function run(
    kind: Exclude<PlatformBillingPending, null>,
    task: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setError(null);
    setPending(kind);
    startTransition(async () => {
      const result = await task();
      setPending(null);
      if (!result.ok) {
        setError(result.message ?? "Something went wrong. Try again.");
        return;
      }
      if (kind === "email") toast.success("Billing email saved.");
      router.refresh();
    });
  }

  return (
    <PlatformBillingSettings
      billingEmail={billingEmail}
      ownerEmail={ownerEmail}
      paymentMethodLabel={paymentMethodLabel}
      canManage={canManage}
      pending={pending}
      error={error}
      onSaveEmail={(email) => run("email", () => saveBillingEmailAction({ slug, email }))}
      onAddCard={() => run("card", () => startCardSetupAction({ slug }))}
    />
  );
}
