import type {
  PaymentsService,
  WebhookDelivery,
  WebhookResult,
  WebhookTarget,
} from "@cohory/payments";

const signatureHeaders = [
  "stripe-signature",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
] as const;

export function webhookResponse(result: WebhookResult): Response {
  return Response.json(
    { received: result.status === 200, outcome: result.outcome },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readWebhookDelivery(request: Request): Promise<WebhookDelivery> {
  const rawBody = await request.text();
  const headers = Object.fromEntries(
    signatureHeaders.map((name) => [name, request.headers.get(name)]),
  );
  return { rawBody, headers };
}

export async function handleWebhookRequest(
  service: Pick<PaymentsService, "handleWebhook">,
  target: WebhookTarget,
  request: Request,
): Promise<Response> {
  return webhookResponse(await service.handleWebhook(target, await readWebhookDelivery(request)));
}
