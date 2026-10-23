import { createRoute, z } from "@hono/zod-openapi";
import { type PlatformBillingService, type PlatformFeesView } from "@cohory/payments/billing";
import { bodyLimit } from "hono/body-limit";

import { createRouter } from "../create-router";
import { routeMeta } from "../route-meta";
import { resolveActor, type SessionResolver } from "../middleware/session";
import { communityIdParams } from "./payments-schemas";
import { errorResponse, json } from "./posts-schemas";

const writeLimit = bodyLimit({ maxSize: 4 * 1024 });

export interface PlatformBillingRouteDeps {
  resolveSession: SessionResolver;
  platformBilling: PlatformBillingService;
}

const security = [{ sessionCookie: [] }];
const tags = ["Payments"];
const base = "/communities/{communityId}/payments/platform-fees";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community does not exist."),
  409: errorResponse("Stripe could not complete the request."),
  422: errorResponse("The input is invalid."),
  503: errorResponse("Platform billing is not available on this server."),
};

const isoDate = z.string().openapi({ format: "date-time" });
const minor = z.number().int().openapi({ description: "Integer amount in minor units (cents)." });
const currency = z.string().openapi({ example: "usd", description: "ISO 4217 code, lowercase." });

const platformInvoiceSchema = z
  .object({
    id: z.uuid(),
    currency,
    periodStart: isoDate,
    periodEnd: isoDate,
    amountMinor: minor,
    amountPaidMinor: minor,
    status: z.enum(["draft", "open", "paid", "void", "uncollectible"]),
    displayStatus: z.enum(["draft", "open", "paid", "void", "uncollectible", "past_due"]),
    number: z.string().nullable(),
    hostedInvoiceUrl: z.string().nullable(),
    dueAt: isoDate.nullable(),
    paidAt: isoDate.nullable(),
    pastDueSince: isoDate.nullable(),
  })
  .openapi("PlatformInvoice");

const platformFeesSchema = z
  .object({
    available: z.boolean(),
    feeBps: z.number().int(),
    periodStart: isoDate,
    nextInvoiceAt: isoDate,
    balances: z.array(
      z.object({ currency, currentMinor: minor, carriedMinor: minor, minimumMinor: minor }),
    ),
    billingEmail: z.string().nullable(),
    paymentMethodLabel: z.string().nullable(),
    suspended: z.boolean(),
    canManage: z.boolean(),
    invoices: z.array(platformInvoiceSchema),
    issues: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum([
          "stripe_amount_mismatch",
          "ledger_amount_mismatch",
          "provider_total_mismatch",
          "stripe_invoice_missing",
        ]),
        currency,
        periodStart: isoDate,
        expectedMinor: minor.nullable(),
        actualMinor: minor.nullable(),
        detectedAt: isoDate,
      }),
    ),
  })
  .openapi("PlatformFees");

const billingEmailBodySchema = z
  .object({ email: z.string().max(254).openapi({ example: "billing@example.com" }) })
  .openapi("PlatformBillingEmailInput");

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function platformFeesJson(view: PlatformFeesView): z.infer<typeof platformFeesSchema> {
  return {
    available: view.available,
    feeBps: view.feeBps,
    periodStart: view.periodStart.toISOString(),
    nextInvoiceAt: view.nextInvoiceAt.toISOString(),
    balances: view.balances.map((balance) => ({ ...balance })),
    billingEmail: view.billingEmail,
    paymentMethodLabel: view.paymentMethodLabel,
    suspended: view.suspended,
    canManage: view.canManage,
    invoices: view.invoices.map((invoice) => ({
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      dueAt: iso(invoice.dueAt),
      paidAt: iso(invoice.paidAt),
      pastDueSince: iso(invoice.pastDueSince),
    })),
    issues: view.issues.map((issue) => ({
      ...issue,
      periodStart: issue.periodStart.toISOString(),
      detectedAt: issue.detectedAt.toISOString(),
    })),
  };
}

const getFees = createRoute({
  method: "get",
  path: base,
  operationId: "getPlatformFees",
  "x-cohory": routeMeta("getPlatformFees"),
  tags,
  security,
  summary: "Get platform fee billing for a community",
  description:
    "Accrued platform fees per currency for providers billed monthly, the billing email and card status, invoice history, and open reconciliation issues. Stripe Connect fees are collected at charge time and do not appear here. Admins and owners only.",
  request: { params: communityIdParams },
  responses: { 200: json(platformFeesSchema, "Platform fee billing."), ...errors },
});

const updateEmail = createRoute({
  method: "put",
  path: `${base}/billing-email`,
  operationId: "updatePlatformBillingEmail",
  "x-cohory": routeMeta("updatePlatformBillingEmail"),
  tags,
  security,
  summary: "Set the platform billing email",
  description: "Invoices and payment notices go to this address. Owner only.",
  middleware: [writeLimit] as const,
  request: {
    params: communityIdParams,
    body: { required: true, content: { "application/json": { schema: billingEmailBodySchema } } },
  },
  responses: {
    200: json(
      z.object({ billingEmail: z.string().nullable() }).openapi("PlatformBillingEmail"),
      "The saved billing email.",
    ),
    ...errors,
  },
});

const setupMethod = createRoute({
  method: "post",
  path: `${base}/payment-method`,
  operationId: "startPlatformBillingPaymentMethodSetup",
  "x-cohory": routeMeta("startPlatformBillingPaymentMethodSetup"),
  tags,
  security,
  summary: "Start saving a card for platform invoices",
  description:
    "Returns a Stripe hosted page where the owner saves a card. Future platform invoices are charged to it automatically. Owner only.",
  middleware: [writeLimit] as const,
  request: { params: communityIdParams },
  responses: {
    200: json(z.object({ url: z.url() }).openapi("PlatformBillingSetup"), "The hosted page URL."),
    ...errors,
  },
});

export function createPlatformBillingRoutes(getDeps: () => PlatformBillingRouteDeps) {
  const app = createRouter();
  app.use(
    "/communities/:communityId/payments/platform-fees",
    resolveActor(() => getDeps().resolveSession),
  );
  app.use(
    "/communities/:communityId/payments/platform-fees/*",
    resolveActor(() => getDeps().resolveSession),
  );

  const billing = () => getDeps().platformBilling;

  return app
    .openapi(getFees, async (c) => {
      const view = await billing().getPlatformFees(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(platformFeesJson(view), 200);
    })
    .openapi(updateEmail, async (c) => {
      const result = await billing().updateBillingEmail(
        c.get("actor"),
        c.req.valid("param").communityId,
        c.req.valid("json"),
      );
      return c.json(result, 200);
    })
    .openapi(setupMethod, async (c) => {
      const result = await billing().startPaymentMethodSetup(
        c.get("actor"),
        c.req.valid("param").communityId,
      );
      return c.json(result, 200);
    });
}
