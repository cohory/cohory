import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// A stand in for the Stripe API, only for the end to end stack. It answers the calls the
// payments gateway makes and records them, and the tests seed the objects that webhook
// handlers fetch. Runs with Node type stripping inside the app image (see compose.e2e.yml).

type Json = Record<string, unknown>;

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly account: string | null;
  readonly idempotencyKey: string | null;
  readonly body: Json;
}

const collections = ["subscriptions", "invoices", "charges", "application_fees", "events"] as const;
type Collection = (typeof collections)[number];

const port = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
const accounts = new Map<string, Json>();
const objects: Record<Collection, Map<string, Json>> = {
  subscriptions: new Map(),
  invoices: new Map(),
  charges: new Map(),
  application_fees: new Map(),
  events: new Map(),
};
const checkoutSessions = new Map<string, Json>();
const calls: RecordedCall[] = [];
const keyedRequests = new Map<string, string>();
let counter = 0;

interface FailureRule {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly code: string;
  remaining: number;
}

const failures: FailureRule[] = [];

function takeFailure(method: string, path: string): FailureRule | null {
  const rule = failures.find(
    (item) => item.remaining > 0 && item.method === method && item.path === path,
  );
  if (!rule) return null;
  rule.remaining -= 1;
  return rule;
}

// Stripe refuses a key reused with different parameters, so the fake does too.
function reusedKey(call: RecordedCall): boolean {
  if (!call.idempotencyKey) return false;
  const scope = `${call.account ?? "platform"}:${call.idempotencyKey}`;
  const request = JSON.stringify([call.method, call.path, call.body]);
  const first = keyedRequests.get(scope);
  if (first === undefined) {
    keyedRequests.set(scope, request);
    return false;
  }
  return first !== request;
}

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_e2e${Date.now().toString(36)}${counter.toString(36)}`;
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function parseBody(raw: string, contentType: string | null): Json {
  if (!raw) return {};
  if (contentType?.includes("application/json")) {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "request-id": nextId("req") });
  response.end(JSON.stringify(body));
}

function missing(response: ServerResponse, what: string): void {
  send(response, 404, {
    error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` },
  });
}

function text(body: Json, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function connectedAccount(id: string, country: string): Json {
  return {
    id,
    object: "v2.core.account",
    livemode: false,
    identity: { country },
    configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
    requirements: { summary: { minimum_deadline: { status: "none" } } },
  };
}

function control(path: string, url: URL, body: Json, response: ServerResponse): void {
  if (path === "/__control/health") return send(response, 200, { ok: true });
  if (path === "/__control/calls") {
    const account = url.searchParams.get("account");
    return send(
      response,
      200,
      calls.filter(
        (call) => account === null || call.account === account || call.body["account"] === account,
      ),
    );
  }
  if (path === "/__control/failures") {
    if (body["clear"] === true) {
      const method = text(body, "method").toUpperCase();
      const target = text(body, "path");
      if (!method || !target) {
        return send(response, 400, { error: { message: "clear needs a method and a path" } });
      }
      for (let index = failures.length - 1; index >= 0; index -= 1) {
        const rule = failures[index];
        if (rule?.method === method && rule.path === target) failures.splice(index, 1);
      }
      return send(response, 200, { ok: true });
    }
    const times = typeof body["times"] === "number" ? body["times"] : 1;
    failures.push({
      method: text(body, "method").toUpperCase(),
      path: text(body, "path"),
      status: typeof body["status"] === "number" ? body["status"] : 500,
      code: text(body, "code") || "api_error",
      remaining: times,
    });
    return send(response, 200, { ok: true });
  }
  if (path === "/__control/objects") {
    for (const collection of collections) {
      const entries = body[collection];
      if (typeof entries !== "object" || entries === null) continue;
      for (const [id, value] of Object.entries(entries)) {
        if (typeof value === "object" && value !== null) objects[collection].set(id, value as Json);
      }
    }
    return send(response, 200, { ok: true });
  }
  missing(response, "control route");
}

function updateSubscription(id: string, body: Json, response: ServerResponse): void {
  const found = objects.subscriptions.get(id);
  if (!found) return missing(response, "subscription");
  const next: Json = { ...found };
  if ("cancel_at_period_end" in body) {
    next["cancel_at_period_end"] = text(body, "cancel_at_period_end") === "true";
  }
  if ("application_fee_percent" in body) {
    const fee = text(body, "application_fee_percent");
    next["application_fee_percent"] = fee === "" ? null : Number(fee);
  }
  objects.subscriptions.set(id, next);
  send(response, 200, next);
}

function cancelSubscription(id: string, response: ServerResponse): void {
  const found = objects.subscriptions.get(id);
  if (!found) return missing(response, "subscription");
  const next: Json = { ...found, status: "canceled", ended_at: Math.floor(Date.now() / 1000) };
  objects.subscriptions.set(id, next);
  send(response, 200, next);
}

function refundApplicationFee(id: string, body: Json, response: ServerResponse): void {
  const found = objects.application_fees.get(id);
  if (!found) return missing(response, "application_fee");
  const amount = Number(text(body, "amount"));
  const refunded = typeof found["amount_refunded"] === "number" ? found["amount_refunded"] : 0;
  const existing = found["refunds"];
  const data =
    typeof existing === "object" && existing !== null && Array.isArray((existing as Json)["data"])
      ? ((existing as Json)["data"] as Json[])
      : [];
  const refund: Json = {
    id: nextId("fr"),
    object: "fee_refund",
    amount,
    currency: found["currency"],
    created: Math.floor(Date.now() / 1000),
    fee: id,
  };
  objects.application_fees.set(id, {
    ...found,
    amount_refunded: refunded + amount,
    refunded: refunded + amount >= Number(found["amount"]),
    refunds: { object: "list", data: [...data, refund], has_more: false },
  });
  send(response, 200, refund);
}

function metadataOf(body: Json): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    const name = /^metadata\[(.+)\]$/.exec(key)?.[1];
    if (name && typeof value === "string") metadata[name] = value;
  }
  return metadata;
}

function list(url: string, data: Json[]): Json {
  return { object: "list", url, has_more: false, data };
}

function invoiceSubscription(invoice: Json): unknown {
  const parent = invoice["parent"];
  const details =
    typeof parent === "object" && parent !== null
      ? (parent as Json)["subscription_details"]
      : undefined;
  return typeof details === "object" && details !== null
    ? (details as Json)["subscription"]
    : invoice["subscription"];
}

function stripeApi(
  method: string,
  path: string,
  body: Json,
  response: ServerResponse,
  account: string | null,
): void {
  const failure = takeFailure(method, path);
  if (failure) {
    return send(response, failure.status, {
      error: { type: "api_error", code: failure.code, message: "Injected failure" },
    });
  }
  if (method === "GET" && path === "/v1/account") {
    return send(response, 200, {
      id: "acct_platform",
      object: "account",
      country: "GB",
      charges_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [] },
    });
  }
  if (method === "POST" && path === "/v2/core/accounts") {
    const id = nextId("acct");
    const identity = body["identity"];
    const country =
      typeof identity === "object" && identity !== null ? text(identity as Json, "country") : "";
    accounts.set(id, connectedAccount(id, country || "GB"));
    return send(response, 200, accounts.get(id));
  }
  let match = path.match(/^\/v2\/core\/accounts\/([^/]+)$/);
  if (match?.[1]) {
    const found = accounts.get(match[1]);
    return found ? send(response, 200, found) : missing(response, "account");
  }
  if (method === "POST" && path === "/v2/core/account_links") {
    const account = text(body, "account");
    return send(response, 200, {
      object: "v2.core.account_link",
      account,
      url: `https://connect.stripe.test/onboard/${account}`,
    });
  }
  if (method === "POST" && path === "/v1/products") {
    return send(response, 200, { id: nextId("prod"), object: "product", active: true });
  }
  if (method === "POST" && path === "/v1/prices") {
    return send(response, 200, {
      id: nextId("price"),
      object: "price",
      active: true,
      currency: text(body, "currency"),
      unit_amount: Number(text(body, "unit_amount")),
      recurring: { interval: text(body, "recurring[interval]") },
    });
  }
  match = path.match(/^\/v1\/products\/([^/]+)$/);
  if (method === "POST" && match?.[1]) {
    return send(response, 200, { id: match[1], object: "product", name: text(body, "name") });
  }
  match = path.match(/^\/v1\/prices\/([^/]+)$/);
  if (method === "POST" && match?.[1]) {
    return send(response, 200, { id: match[1], object: "price", active: false });
  }
  if (method === "POST" && path === "/v1/checkout/sessions") {
    const id = nextId("cs");
    const session: Json = {
      id,
      object: "checkout.session",
      mode: "subscription",
      status: "open",
      metadata: metadataOf(body),
      url: `https://checkout.stripe.test/pay/${id}`,
    };
    checkoutSessions.set(id, { ...session, account, customer: text(body, "customer") || null });
    return send(response, 200, session);
  }
  if (method === "GET" && path === "/v1/checkout/sessions") {
    const open = [...checkoutSessions.values()].filter(
      (session) =>
        session["account"] === account &&
        session["status"] === text(body, "status") &&
        (!text(body, "customer") || session["customer"] === text(body, "customer")),
    );
    return send(response, 200, list(path, open));
  }
  match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
  if (method === "POST" && match?.[1]) {
    const found = checkoutSessions.get(match[1]);
    if (!found) return missing(response, "checkout session");
    const expired: Json = { ...found, status: "expired" };
    checkoutSessions.set(match[1], expired);
    return send(response, 200, expired);
  }
  if (method === "GET" && path === "/v1/invoices") {
    const paid = [...objects.invoices.values()].filter(
      (invoice) =>
        invoiceSubscription(invoice) === text(body, "subscription") &&
        invoice["status"] === text(body, "status"),
    );
    return send(response, 200, list(path, paid));
  }
  if (method === "POST" && path === "/v1/billing_portal/sessions") {
    return send(response, 200, {
      id: nextId("bps"),
      object: "billing_portal.session",
      url: `https://billing.stripe.test/portal/${text(body, "customer")}`,
    });
  }
  match = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
  if (method === "POST" && match?.[1]) return updateSubscription(match[1], body, response);
  if (method === "DELETE" && match?.[1]) return cancelSubscription(match[1], response);
  match = path.match(/^\/v1\/application_fees\/([^/]+)\/refunds$/);
  if (method === "POST" && match?.[1]) return refundApplicationFee(match[1], body, response);
  match = path.match(/^\/v1\/(subscriptions|invoices|charges|application_fees|events)\/([^/]+)$/);
  if (method === "GET" && match?.[1] && match[2]) {
    const collection = collections.find((name) => name === match?.[1]);
    const found = collection ? objects[collection].get(match[2]) : undefined;
    return found ? send(response, 200, found) : missing(response, match[1]);
  }
  send(response, 404, {
    error: {
      type: "invalid_request_error",
      message: `Unrecognized request URL (${method}: ${path}).`,
    },
  });
}

const server = createServer((request, response) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    raw += chunk;
  });
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://fake-stripe");
    const method = request.method ?? "GET";
    let body: Json;
    try {
      body = parseBody(raw, header(request, "content-type"));
    } catch {
      return send(response, 400, { error: { type: "invalid_request_error", message: "bad body" } });
    }
    if (method === "DELETE" || method === "GET") {
      body = { ...Object.fromEntries(url.searchParams), ...body };
    }
    if (url.pathname.startsWith("/__control/")) return control(url.pathname, url, body, response);
    const call: RecordedCall = {
      method,
      path: url.pathname,
      account: header(request, "stripe-account"),
      idempotencyKey: header(request, "idempotency-key"),
      body,
    };
    calls.push(call);
    if (reusedKey(call)) {
      return send(response, 400, {
        error: {
          type: "idempotency_error",
          message:
            "Keys for idempotent requests can only be used with the same parameters they were first used with.",
        },
      });
    }
    stripeApi(method, url.pathname, body, response, call.account);
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`fake stripe listening on ${port}\n`);
});
