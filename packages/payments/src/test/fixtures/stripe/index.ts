import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import Stripe from "stripe";
import { z } from "zod";

import type { StripeGateway } from "../../../gateway";
import { createStripeGateway } from "../../../stripe-gateway";
import { rememberSignedEvent } from "../../fake-gateway";

export const recordedEventTypes = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "application_fee.created",
  "application_fee.refunded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.closed",
  "account.updated",
] as const;

export type RecordedEventType = (typeof recordedEventTypes)[number];

export type RecordedObjectName =
  | "invoice"
  | "charge"
  | "applicationFee"
  | "subscription"
  | "dispute"
  | "disputedCharge"
  | "disputedFee";

const objectSchema = z.looseObject({ id: z.string().min(1), object: z.string().min(1) });

export type RecordedObject = z.output<typeof objectSchema>;

const eventSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  livemode: z.literal(false),
  data: z.looseObject({ object: objectSchema }),
});

export type RecordedEvent = z.output<typeof eventSchema>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

export function recordedEvent(type: RecordedEventType): RecordedEvent {
  return eventSchema.parse(readJson(`./events/${type}.json`));
}

export function recordedObject(name: RecordedObjectName): RecordedObject {
  return objectSchema.parse(readJson(`./objects/${name}.json`));
}

export function signRecorded(
  event: RecordedEvent,
  account: string,
  options: { readonly id?: string; readonly secret?: string } = {},
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify({ ...event, id: options.id ?? event.id, account });
  rememberSignedEvent(rawBody);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: options.secret ?? "whsec_connect",
  });
  return { rawBody, signature };
}

export async function withRecordedStripe<T>(
  objects: readonly RecordedObject[],
  run: (gateway: StripeGateway) => Promise<T>,
): Promise<T> {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0] ?? "";
    const object = byId.get(path.split("/").at(-1) ?? "");
    response.setHeader("content-type", "application/json");
    if (!object) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { type: "invalid_request_error", message: path } }));
      return;
    }
    response.end(JSON.stringify(object));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(
      createStripeGateway("sk_test_recorded", { apiBaseUrl: `http://127.0.0.1:${port}` }),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
