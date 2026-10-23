import { listMyPaidMemberships } from "@cohory/payments/account";
import type { Metadata } from "next";

import { actorFor } from "../../../../lib/actor";
import { requireAccountSession } from "../session";
import { PaidMemberships } from "./paid-memberships";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const session = await requireAccountSession("/account/billing");
  const rows = await listMyPaidMemberships(actorFor(session));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text">Billing</h1>
        <p className="text-sm text-text-muted">
          Every paid membership you have, and where to change or cancel it.
        </p>
      </div>
      <PaidMemberships
        items={rows.map((row) => ({
          communitySlug: row.communitySlug,
          communityName: row.communityName,
          planName: row.planName,
          amountMinor: row.amountMinor,
          currency: row.currency,
          interval: row.interval,
          providerStatus: row.providerStatus,
          nextChargeAt: row.nextChargeAt,
          endsAt: row.endsAt,
          billing: row.billing,
        }))}
      />
    </div>
  );
}
