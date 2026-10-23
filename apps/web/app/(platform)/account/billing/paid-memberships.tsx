"use client";

import { PaidMembershipList, type PaidMembershipItem } from "@cohory/ui";
import { useState, useTransition } from "react";

import { openBillingPortalAction } from "../../../../lib/payments/actions";

export function PaidMemberships({ items }: { items: PaidMembershipItem[] }) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function manageBilling(slug: string) {
    setError(null);
    setPendingSlug(slug);
    startTransition(async () => {
      const result = await openBillingPortalAction({ slug, returnTo: "account" });
      setError(result.message);
      setPendingSlug(null);
    });
  }

  return (
    <PaidMembershipList
      items={items}
      onManageBilling={manageBilling}
      pendingSlug={pendingSlug}
      error={error}
    />
  );
}
