import type { PaymentsService } from "@cohory/payments";
import type { PlatformBillingService } from "@cohory/payments/billing";

import { readWebhookDelivery, webhookResponse } from "./webhook";

type PaymentsWebhooks = Pick<PaymentsService, "handleWebhook">;
type BillingWebhooks = Pick<PlatformBillingService, "handlePlatformBillingWebhook">;

export async function handlePlatformStripeWebhookRequest(
  payments: PaymentsWebhooks,
  billing: BillingWebhooks,
  request: Request,
): Promise<Response> {
  const delivery = await readWebhookDelivery(request);
  const billed = await billing.handlePlatformBillingWebhook({
    rawBody: delivery.rawBody,
    signature: request.headers.get("stripe-signature"),
  });
  return webhookResponse(
    billed ?? (await payments.handleWebhook({ setup: "platform_account" }, delivery)),
  );
}
