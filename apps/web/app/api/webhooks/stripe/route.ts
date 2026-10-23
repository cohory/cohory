import { getPaymentsService } from "@cohory/payments";
import { getPlatformBillingService } from "@cohory/payments/billing";

import { handlePlatformStripeWebhookRequest } from "../../../../lib/payments/billing-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handlePlatformStripeWebhookRequest(
    getPaymentsService(),
    getPlatformBillingService(),
    request,
  );
}
