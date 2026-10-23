import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// A stand in for the Polar API and its hosted pages, for local runs and end to end stacks.
// Point the app at it with POLAR_API_BASE_URL. It answers the calls the Polar adapter makes,
// serves a hosted checkout and customer portal, and signs webhooks with Standard Webhooks.
// Runs with Node type stripping: `node packages/payments/support/fake-polar/server.mts`.

type Json = Record<string, unknown>;

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly body: Json;
}

interface Endpoint {
  url: string;
  secret: string;
}

const port = Number(process.env.FAKE_POLAR_PORT ?? 12112);
const publicUrl = (process.env.FAKE_POLAR_PUBLIC_URL ?? `http://localhost:${port}`).replace(
  /\/$/,
  "",
);
const organizationId = "8f2b7c1e-1d2a-4c55-9a0e-5b8f0c7d1a01";
const products = new Map<string, Json>();
const checkouts = new Map<string, Json>();
const subscriptions = new Map<string, Json>();
const orders = new Map<string, Json>();
const calls: RecordedCall[] = [];
const deliveries: Json[] = [];
let endpoint: Endpoint | null = null;

function now(): string {
  return new Date().toISOString();
}

function text(body: Json, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function num(body: Json, key: string): number {
  const value = body[key];
  return typeof value === "number" ? value : 0;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake Polar</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui; max-width: 32rem; margin: 2rem auto; padding: 0 1rem">
<p><strong>Fake Polar sandbox</strong> (test data only)</p>${body}</body></html>`);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

function missing(response: ServerResponse): void {
  send(response, 404, { error: "ResourceNotFound", detail: "Not found" });
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function signingKey(secret: string): Buffer {
  return Buffer.from(secret.slice("whsec_".length), "base64");
}

async function deliver(type: string, data: Json): Promise<Json> {
  if (!endpoint) {
    const skipped = { type, delivered: false, reason: "no webhook endpoint" };
    deliveries.push(skipped);
    return skipped;
  }
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type, timestamp: now(), data });
  const signature = createHmac("sha256", signingKey(endpoint.secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: rawBody,
  }).catch(() => null);
  const outcome = { type, id, status: response?.status ?? null };
  deliveries.push(outcome);
  return outcome;
}

function organization(): Json {
  return {
    id: organizationId,
    name: "Fake Polar organization",
    slug: "fake-polar",
    status: "active",
    details_submitted_at: "2026-10-01T09:30:00Z",
    capabilities: { checkout_payments: true, refunds: true },
  };
}

function matchesMetadata(product: Json, query: URLSearchParams): boolean {
  const metadata = (product["metadata"] ?? {}) as Json;
  for (const [key, value] of query.entries()) {
    const found = key.match(/^metadata\[(.+)\]$/);
    if (found?.[1] && String(metadata[found[1]]) !== value) return false;
  }
  return query.get("is_archived") !== "false" || product["is_archived"] !== true;
}

async function pay(checkoutId: string): Promise<string | null> {
  const checkout = checkouts.get(checkoutId);
  if (!checkout) return null;
  const product = products.get(text(checkout, "product_id"));
  const prices = (product?.["prices"] ?? []) as Json[];
  const amount = num(prices[0] ?? {}, "price_amount");
  const currency = text(prices[0] ?? {}, "price_currency") || "usd";
  const interval = text(product ?? {}, "recurring_interval") || "month";
  const customerId = text(checkout, "customer_id") || randomUUID();
  const subscriptionId = randomUUID();
  const periodEnd = new Date(Date.now() + (interval === "year" ? 365 : 30) * 86_400_000);
  const subscription: Json = {
    id: subscriptionId,
    status: "active",
    amount,
    currency,
    recurring_interval: interval,
    recurring_interval_count: 1,
    customer_id: customerId,
    product_id: text(checkout, "product_id"),
    current_period_start: now(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    canceled_at: null,
    ends_at: null,
    ended_at: null,
    metadata: checkout["metadata"] ?? {},
    customer: {
      id: customerId,
      email: text(checkout, "customer_email") || null,
      external_id: text(checkout, "external_customer_id") || null,
    },
  };
  subscriptions.set(subscriptionId, subscription);
  const order: Json = {
    id: randomUUID(),
    created_at: now(),
    status: "paid",
    paid: true,
    net_amount: amount,
    tax_amount: 0,
    total_amount: amount,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    refundable_amount: amount,
    currency,
    billing_reason: "subscription_create",
    customer_id: customerId,
    subscription_id: subscriptionId,
    metadata: {},
  };
  orders.set(text(order, "id"), order);
  checkouts.set(checkoutId, { ...checkout, status: "succeeded", subscription_id: subscriptionId });
  await deliver("subscription.created", subscription);
  await deliver("order.paid", order);
  return text(checkout, "success_url").replace("{CHECKOUT_ID}", checkoutId);
}

async function api(method: string, url: URL, body: Json, response: ServerResponse) {
  const path = url.pathname;
  if (method === "GET" && path === "/v1/organizations/") {
    return send(response, 200, { items: [organization()], pagination: { total_count: 1 } });
  }
  if (method === "GET" && path === "/v1/products/") {
    const items = [...products.values()].filter((p) => matchesMetadata(p, url.searchParams));
    return send(response, 200, { items, pagination: { total_count: items.length } });
  }
  if (method === "POST" && path === "/v1/products/") {
    const id = randomUUID();
    const product = { ...body, id, is_archived: false, organization_id: organizationId };
    products.set(id, product);
    return send(response, 201, product);
  }
  let match = path.match(/^\/v1\/products\/([^/]+)$/);
  if (match?.[1] && method === "PATCH") {
    const product = products.get(match[1]);
    if (!product) return missing(response);
    products.set(match[1], { ...product, ...body });
    return send(response, 200, products.get(match[1]));
  }
  if (method === "POST" && path === "/v1/checkouts/") {
    const id = randomUUID();
    const productIds = Array.isArray(body["products"]) ? body["products"] : [];
    const checkout = {
      ...body,
      id,
      status: "open",
      product_id: String(productIds[0] ?? ""),
      url: `${publicUrl}/checkout/${id}`,
    };
    checkouts.set(id, checkout);
    return send(response, 201, checkout);
  }
  if (method === "POST" && path === "/v1/customer-sessions/") {
    const customer = text(body, "customer_id");
    return send(response, 201, {
      id: randomUUID(),
      token: `polar_cst_${randomUUID()}`,
      customer_id: customer,
      return_url: text(body, "return_url"),
      customer_portal_url: `${publicUrl}/portal/${customer}?return=${encodeURIComponent(text(body, "return_url"))}`,
    });
  }
  match = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
  if (match?.[1]) {
    const id = match[1];
    const subscription = subscriptions.get(id);
    if (!subscription) return missing(response);
    if (method === "PATCH") {
      const revoke = body["revoke"] === true;
      subscriptions.set(id, {
        ...subscription,
        ...(revoke
          ? { status: "canceled", ended_at: now(), cancel_at_period_end: false }
          : { cancel_at_period_end: body["cancel_at_period_end"] === true }),
      });
      await deliver(revoke ? "subscription.revoked" : "subscription.updated", { id });
    }
    return send(response, 200, subscriptions.get(id));
  }
  match = path.match(/^\/v1\/orders\/([^/]+)$/);
  if (match?.[1]) {
    const order = orders.get(match[1]);
    return order ? send(response, 200, order) : missing(response);
  }
  if (method === "POST" && path === "/v1/refunds/") {
    const order = orders.get(text(body, "order_id"));
    if (!order) return missing(response);
    const refunded = num(order, "refunded_amount") + num(body, "amount");
    const updated = {
      ...order,
      refunded_amount: refunded,
      refundable_amount: num(order, "net_amount") - refunded,
      status: refunded >= num(order, "net_amount") ? "refunded" : "partially_refunded",
    };
    orders.set(text(order, "id"), updated);
    await deliver("order.refunded", { id: text(order, "id") });
    return send(response, 201, {
      id: randomUUID(),
      status: "succeeded",
      reason: text(body, "reason"),
      amount: num(body, "amount"),
      tax_amount: 0,
      currency: text(order, "currency"),
      order_id: text(order, "id"),
      metadata: body["metadata"] ?? {},
    });
  }
  match = path.match(/^\/v1\/customers\/([^/]+)$/);
  if (match?.[1] && method === "DELETE") {
    response.writeHead(204);
    return response.end();
  }
  return missing(response);
}

async function pages(method: string, url: URL, form: URLSearchParams, response: ServerResponse) {
  const path = url.pathname;
  if (path === "/dashboard/webhooks") {
    if (method === "POST") {
      endpoint = {
        url: form.get("url") ?? "",
        secret: `whsec_${randomBytes(24).toString("base64")}`,
      };
    }
    return html(
      response,
      `<h1>Webhooks</h1>
<form method="post"><label>Endpoint URL <input name="url" size="60" value="${escape(endpoint?.url ?? "")}"></label>
<button type="submit">Save endpoint</button></form>
${endpoint ? `<p>Signing secret</p><pre id="secret">${escape(endpoint.secret)}</pre>` : "<p>No endpoint yet.</p>"}`,
    );
  }
  let match = path.match(/^\/checkout\/([^/]+)(\/pay)?$/);
  if (match?.[1]) {
    const checkout = checkouts.get(match[1]);
    if (!checkout) return missing(response);
    if (method === "POST" && match[2]) {
      const next = await pay(match[1]);
      return next ? redirect(response, next) : missing(response);
    }
    return html(
      response,
      `<h1>Checkout</h1><p>Paying as ${escape(text(checkout, "customer_email") || "a customer")}.</p>
<form method="post" action="/checkout/${escape(match[1])}/pay"><button type="submit">Pay now</button></form>
<p><a href="${escape(text(checkout, "return_url"))}">Back</a></p>`,
    );
  }
  match = path.match(/^\/portal\/([^/]+)$/);
  if (match?.[1]) {
    const back = url.searchParams.get("return") ?? "/";
    const mine = [...subscriptions.values()].filter((s) => s["customer_id"] === match?.[1]);
    if (method === "POST") {
      const id = form.get("subscription") ?? "";
      const subscription = subscriptions.get(id);
      if (subscription) {
        subscriptions.set(id, { ...subscription, cancel_at_period_end: true });
        await deliver("subscription.updated", { id });
      }
      return redirect(response, back);
    }
    return html(
      response,
      `<h1>Customer portal</h1>${mine
        .map(
          (s) =>
            `<form method="post"><input type="hidden" name="subscription" value="${escape(String(s["id"]))}">
<p>Subscription ${escape(String(s["status"]))}${s["cancel_at_period_end"] ? ", ends at period end" : ""}</p>
<button type="submit">Cancel at period end</button></form>`,
        )
        .join("")}<p><a href="${escape(back)}">Back to the community</a></p>`,
    );
  }
  return missing(response);
}

async function fixtures(method: string, path: string, body: Json, response: ServerResponse) {
  if (path === "/__fixtures/health") return send(response, 200, { ok: true });
  if (path === "/__fixtures/calls") return send(response, 200, calls);
  if (path === "/__fixtures/deliveries") return send(response, 200, deliveries);
  if (path === "/__fixtures/webhook-endpoint" && method === "POST") {
    endpoint = { url: text(body, "url"), secret: text(body, "secret") };
    return send(response, 200, { ok: true });
  }
  if (path === "/__fixtures/deliver" && method === "POST") {
    const data = typeof body["data"] === "object" && body["data"] !== null ? body["data"] : {};
    return send(response, 200, await deliver(text(body, "type"), data as Json));
  }
  return missing(response);
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url ?? "/", publicUrl);
    const method = request.method ?? "GET";
    const isForm = (request.headers["content-type"] ?? "").includes("form-urlencoded");
    const form = new URLSearchParams(isForm ? raw : "");
    let body: Json = {};
    if (raw && !isForm) {
      const parsed: unknown = JSON.parse(raw);
      body = typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
    }
    const run = url.pathname.startsWith("/v1/")
      ? (calls.push({ method, path: url.pathname, body }), api(method, url, body, response))
      : url.pathname.startsWith("/__fixtures/")
        ? fixtures(method, url.pathname, body, response)
        : pages(method, url, form, response);
    run.catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : "failed" });
    });
  });
});

server.listen(port, () => {
  console.info(JSON.stringify({ level: "info", msg: "fake polar listening", port }));
});
