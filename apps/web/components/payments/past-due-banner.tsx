import { getPaymentsService } from "@cohory/payments";
import { Alert, AlertDescription, AlertTitle } from "@cohory/ui";
import Link from "next/link";

import { membershipHref } from "../../lib/payments/views";

export async function PastDueBanner({
  slug,
  communityId,
  userId,
}: {
  slug: string;
  communityId: string;
  userId: string;
}) {
  const access = await getPaymentsService().getMembershipAccess(communityId, userId);
  if (access.level !== "member" || access.source !== "subscription" || access.state !== "grace") {
    return null;
  }
  return (
    <Alert variant="warning" className="mb-6">
      <AlertTitle>Payment failed</AlertTitle>
      <AlertDescription>
        Update your payment method to keep your access.{" "}
        <Link
          href={membershipHref(slug)}
          className="rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Manage billing
        </Link>
      </AlertDescription>
    </Alert>
  );
}
