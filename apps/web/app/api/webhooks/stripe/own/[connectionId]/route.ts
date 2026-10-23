import { getPaymentsService } from "@cohory/payments";

import { handleWebhookRequest } from "../../../../../../lib/payments/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: RouteContext<"/api/webhooks/stripe/own/[connectionId]">,
): Promise<Response> {
  const { connectionId } = await context.params;
  return handleWebhookRequest(getPaymentsService(), { setup: "own_keys", connectionId }, request);
}
