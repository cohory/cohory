import { ForbiddenError } from "@cohory/authz";
import { getCommunityById, type CommunityId } from "@cohory/db";
import {
  communities,
  platformBillingAccounts,
  platformBillingIssues,
  platformInvoiceLines,
  platformInvoices,
  providerEvents,
} from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { PaymentsValidationError } from "../errors";
import { signedEvent } from "../test/fake-gateway";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  openTestDb,
  user,
} from "../test/fixtures";
import { createBillingHarness, insertAccrual } from "./testing/harness";

const admin = openTestDb();
const h = createBillingHarness(admin.db);

afterAll(() => admin.close());

const oct = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const nov = (day: number) => new Date(Date.UTC(2026, 10, day, 12));

interface Community {
  readonly id: CommunityId;
  readonly ownerId: string;
  readonly adminId: string;
  readonly memberId: string;
}

const scope: CommunityId[] = [];

async function community(): Promise<Community> {
  const id = await insertCommunity(admin.db);
  scope.push(id);
  return {
    id,
    ownerId: await insertMember(admin.db, id, "owner"),
    adminId: await insertMember(admin.db, id, "admin"),
    memberId: await insertMember(admin.db, id, "member"),
  };
}

function invoicesOf(communityId: CommunityId) {
  return admin.db
    .select()
    .from(platformInvoices)
    .where(eq(platformInvoices.communityId, communityId))
    .orderBy(platformInvoices.periodStart, platformInvoices.currency);
}

async function invoiceIn(communityId: CommunityId, currency: string) {
  const invoice = (await invoicesOf(communityId)).find((row) => row.currency === currency);
  if (!invoice) throw new Error(`no ${currency} invoice`);
  return { ...invoice, communityId };
}

function invoiceEvent(
  type: string,
  invoice: { id: string; communityId: string; stripeInvoiceId: string | null },
  options: { account?: string | null; secret?: string } = {},
) {
  return signedEvent(
    type,
    {
      id: invoice.stripeInvoiceId ?? "",
      object: "invoice",
      metadata: {
        cohory_platform_invoice_id: invoice.id,
        cohory_community_id: invoice.communityId,
      },
    },
    options,
  );
}

async function saveCard(c: Community): Promise<void> {
  const { url } = await h.service.startPaymentMethodSetup(user(c.ownerId), c.id);
  const sessionId = url.split("/").pop() ?? "";
  h.gateway.completeSetup(sessionId, `pm_card_${c.id.slice(-6)}`);
  const account = await admin.db
    .select()
    .from(platformBillingAccounts)
    .where(eq(platformBillingAccounts.communityId, c.id));
  const event = signedEvent("checkout.session.completed", {
    id: sessionId,
    object: "checkout.session",
    mode: "setup",
    metadata: { cohory_community_id: c.id, cohory_billing_account_id: account[0]?.id ?? "" },
  });
  expect(
    await h.service.handlePlatformBillingWebhook({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  ).toEqual({ status: 200, outcome: "processed" });
}

describe("monthly platform invoices", () => {
  const state: { main?: Community } = {};

  it("invoices the closed month once per currency and leaves the open month alone", async () => {
    const c = await community();
    state.main = c;
    await insertAccrual(admin.db, c.id, { feeMinor: 300, occurredAt: oct(3) });
    await insertAccrual(admin.db, c.id, { feeMinor: 400, occurredAt: oct(30) });
    await insertAccrual(admin.db, c.id, { feeMinor: 600, currency: "eur", occurredAt: oct(9) });
    await insertAccrual(admin.db, c.id, { feeMinor: 900, occurredAt: nov(1) });
    await insertAccrual(admin.db, c.id, {
      feeMinor: 1000,
      occurredAt: oct(5),
      kind: "fee_collected",
      collectionMethod: "automatic_split",
    });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");

    const result = await h.service.generateInvoices({ communityIds: scope });

    expect(result.period).toBe("2026-10");
    const invoices = await invoicesOf(c.id);
    expect(invoices.map((row) => [row.currency, row.amountMinor, row.status])).toEqual([
      ["eur", 600, "open"],
      ["usd", 700, "open"],
    ]);
    const usd = await invoiceIn(c.id, "usd");
    expect(usd.collectionMethod).toBe("send_invoice");
    expect(usd.periodStart.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(usd.periodEnd.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(usd.hostedInvoiceUrl).toMatch(/^https:\/\/invoice\.stripe\.test\//);
    const lines = await admin.db
      .select()
      .from(platformInvoiceLines)
      .where(eq(platformInvoiceLines.invoiceId, usd.id));
    expect(lines.map((line) => line.amountMinor).sort()).toEqual([300, 400]);
    const input = h.gateway.inputs.get(usd.stripeInvoiceId ?? "");
    expect(input).toMatchObject({
      currency: "usd",
      amountMinor: 700,
      collectionMethod: "send_invoice",
      metadata: { cohory_platform_invoice_id: usd.id, cohory_community_id: c.id },
    });
    expect(
      h.gateway.writes("sendInvoice").some((call) => call.idempotencyKey?.includes(usd.id)),
    ).toBe(true);
    const mail = h.emails.filter((email) => email.text.includes(usd.hostedInvoiceUrl ?? "-"));
    expect(mail).toHaveLength(0);
  });

  it("asks Stripe to send the invoice email again instead of sending a second copy", async () => {
    const c = state.main;
    if (!c) throw new Error("setup");
    const usd = await invoiceIn(c.id, "usd");
    const sendsBefore = h.gateway.writes("sendInvoice").length;
    const emailsBefore = h.emails.length;

    await h.service.resendPlatformInvoice(c.id, usd.id);
    await h.service.resendPlatformInvoice(c.id, usd.id);

    const resends = h.gateway.writes("sendInvoice").slice(sendsBefore);
    expect(resends).toHaveLength(2);
    expect(resends[0]?.idempotencyKey).toMatch(new RegExp(`^platform-invoice:${usd.id}:resend:`));
    expect(resends[0]?.idempotencyKey).not.toBe(resends[1]?.idempotencyKey);
    expect(h.emails).toHaveLength(emailsBefore);
  });

  it("does not bill a period twice", async () => {
    const c = state.main;
    if (!c) throw new Error("setup");
    const before = h.gateway.writes("createInvoice").length;

    await h.service.generateInvoices({ communityIds: scope });

    expect(await invoicesOf(c.id)).toHaveLength(2);
    expect(h.gateway.writes("createInvoice")).toHaveLength(before);
  });

  it("marks a sent invoice paid from the invoice.paid webhook", async () => {
    const c = state.main;
    if (!c) throw new Error("setup");
    const usd = await invoiceIn(c.id, "usd");
    h.gateway.markPaid(usd.stripeInvoiceId ?? "", new Date("2026-11-03T09:00:00.000Z"));
    const event = invoiceEvent("invoice.paid", usd);

    const outcome = await h.service.handlePlatformBillingWebhook({
      rawBody: event.rawBody,
      signature: event.signature,
    });

    expect(outcome).toEqual({ status: 200, outcome: "processed" });
    const paid = await invoiceIn(c.id, "usd");
    expect(paid.status).toBe("paid");
    expect(paid.amountPaidMinor).toBe(700);
    expect(paid.paidAt?.toISOString()).toBe("2026-11-03T09:00:00.000Z");
  });

  it("leaves connected account events, other events, and bad signatures to the payments handler", async () => {
    const c = state.main;
    if (!c) throw new Error("setup");
    const usd = await invoiceIn(c.id, "usd");
    const connected = invoiceEvent("invoice.paid", usd, { account: "acct_creator" });
    const wrong = invoiceEvent("invoice.paid", usd, { secret: "whsec_wrong" });
    const other = signedEvent("customer.subscription.updated", { id: "sub_x" });

    for (const event of [connected, wrong, other]) {
      expect(
        await h.service.handlePlatformBillingWebhook({
          rawBody: event.rawBody,
          signature: event.signature,
        }),
      ).toBeNull();
    }
  });

  it("voids an invoice and keeps the status through a replayed voided event", async () => {
    const c = state.main;
    if (!c) throw new Error("setup");
    const eur = await invoiceIn(c.id, "eur");

    await h.service.voidPlatformInvoice(c.id, eur.id);
    const event = invoiceEvent("invoice.voided", eur);
    await h.service.handlePlatformBillingWebhook({
      rawBody: event.rawBody,
      signature: event.signature,
    });

    const voided = await invoiceIn(c.id, "eur");
    expect(voided.status).toBe("void");
    expect(voided.voidedAt).not.toBeNull();
  });

  it("carries a balance below 5 USD forward and bills it once the balance reaches the minimum", async () => {
    const c = await community();
    await insertAccrual(admin.db, c.id, { feeMinor: 300, occurredAt: oct(10) });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");

    await h.service.generateInvoices({ communityIds: scope });
    expect(await invoicesOf(c.id)).toHaveLength(0);
    const view = await h.service.getPlatformFees(user(c.ownerId), c.id);
    expect(view.balances).toEqual([
      { currency: "usd", currentMinor: 0, carriedMinor: 300, minimumMinor: 500 },
    ]);

    await insertAccrual(admin.db, c.id, { feeMinor: 250, occurredAt: nov(20) });
    h.clock.now = new Date("2026-12-01T00:10:00.000Z");
    await h.service.generateInvoices({ communityIds: scope });

    const invoices = await invoicesOf(c.id);
    expect(invoices.map((row) => [row.periodStart.toISOString(), row.amountMinor])).toEqual([
      ["2026-11-01T00:00:00.000Z", 550],
    ]);
  });

  it("nets periodic fee refunds against accruals and ignores automatic split refunds", async () => {
    const c = await community();
    await insertAccrual(admin.db, c.id, { feeMinor: 800, occurredAt: oct(2) });
    await insertAccrual(admin.db, c.id, {
      feeMinor: -400,
      occurredAt: oct(4),
      kind: "fee_refunded",
    });
    await insertAccrual(admin.db, c.id, {
      feeMinor: -900,
      occurredAt: oct(4),
      kind: "fee_refunded",
      collectionMethod: "automatic_split",
    });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");

    await h.service.generateInvoices({ communityIds: scope });

    expect(await invoicesOf(c.id)).toHaveLength(0);
    const view = await h.service.getPlatformFees(user(c.adminId), c.id);
    expect(view.balances[0]?.carriedMinor).toBe(400);
  });

  it("charges the saved card automatically", async () => {
    const c = await community();
    await saveCard(c);
    const view = await h.service.getPlatformFees(user(c.ownerId), c.id);
    expect(view.paymentMethodLabel).toBe("Visa ending 4242");
    await insertAccrual(admin.db, c.id, { feeMinor: 1200, occurredAt: oct(12) });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");
    const emailsBefore = h.emails.length;

    await h.service.generateInvoices({ communityIds: scope });

    const invoice = await invoiceIn(c.id, "usd");
    expect(invoice.collectionMethod).toBe("charge_automatically");
    expect(invoice.status).toBe("paid");
    expect(invoice.amountPaidMinor).toBe(1200);
    expect(h.emails).toHaveLength(emailsBefore);
  });
});

describe("dunning", () => {
  it("marks a failed payment past due, tells the owner once, pauses after 30 days, and resumes when paid", async () => {
    const c = await community();
    await saveCard(c);
    await insertAccrual(admin.db, c.id, { feeMinor: 2000, occurredAt: oct(15) });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");
    h.gateway.failNextPayment = true;

    await h.service.generateInvoices({ communityIds: scope });

    const failed = await invoiceIn(c.id, "usd");
    expect(failed.status).toBe("open");
    expect(failed.pastDueSince?.toISOString()).toBe("2026-11-01T00:10:00.000Z");
    const ownerMail = () => h.emails.filter((email) => email.subject.includes("Payment failed"));
    expect(
      ownerMail().filter((email) => email.text.includes(failed.hostedInvoiceUrl ?? "-")),
    ).toHaveLength(1);
    const slug = (await getCommunityById(admin.db, c.id))?.slug;
    const [failedMail] = ownerMail().filter((email) =>
      email.text.includes(failed.hostedInvoiceUrl ?? "-"),
    );
    expect(failedMail?.text).toContain(
      `http://localhost:3000/c/${slug}/manage/payments/platform-fees`,
    );

    const replay = invoiceEvent("invoice.payment_failed", failed);
    await h.service.handlePlatformBillingWebhook({
      rawBody: replay.rawBody,
      signature: replay.signature,
    });
    expect(
      ownerMail().filter((email) => email.text.includes(failed.hostedInvoiceUrl ?? "-")),
    ).toHaveLength(1);
    expect(await h.service.isBillingSuspended(c.id)).toBe(false);
    const view = await h.service.getPlatformFees(user(c.ownerId), c.id);
    expect(view.invoices[0]?.displayStatus).toBe("past_due");

    h.clock.now = new Date("2026-11-30T00:09:00.000Z");
    await h.service.reconcile({ communityIds: scope });
    expect(await h.service.isBillingSuspended(c.id)).toBe(false);

    h.clock.now = new Date("2026-12-01T00:10:00.000Z");
    await h.service.reconcile({ communityIds: scope });
    expect(await h.service.isBillingSuspended(c.id)).toBe(true);
    const paused = h.emails.find(
      (email) =>
        email.subject.includes("New paid signups are paused") &&
        email.text.includes(`/c/${slug}/manage/payments/platform-fees`),
    );
    expect(paused).toBeDefined();

    h.gateway.markPaid(failed.stripeInvoiceId ?? "", new Date("2026-12-02T00:00:00.000Z"));
    const paid = invoiceEvent("invoice.paid", failed);
    await h.service.handlePlatformBillingWebhook({
      rawBody: paid.rawBody,
      signature: paid.signature,
    });
    expect(await h.service.isBillingSuspended(c.id)).toBe(false);
    expect((await invoiceIn(c.id, "usd")).status).toBe("paid");
  }, 30_000);
});

describe("reconciliation", () => {
  it("finds no mismatch for a clean invoice, then flags Stripe and provider differences and resolves them", async () => {
    const c = await community();
    await insertAccrual(admin.db, c.id, { feeMinor: 900, occurredAt: oct(20) });
    h.clock.now = new Date("2026-11-01T00:10:00.000Z");
    await h.service.generateInvoices({ communityIds: scope });
    const invoice = await invoiceIn(c.id, "usd");
    const openIssues = () =>
      admin.db
        .select()
        .from(platformBillingIssues)
        .where(
          and(
            eq(platformBillingIssues.communityId, c.id),
            isNull(platformBillingIssues.resolvedAt),
          ),
        );

    h.clock.now = new Date("2026-11-02T03:00:00.000Z");
    await h.service.reconcile({ communityIds: scope });
    expect(await openIssues()).toEqual([]);

    const stripeId = invoice.stripeInvoiceId ?? "";
    const stripe = h.gateway.invoices.get(stripeId);
    if (!stripe) throw new Error("no stripe invoice");
    h.gateway.invoices.set(stripeId, { ...stripe, totalMinor: 901 });
    h.provider.total = 12_345;
    await h.service.reconcile({ communityIds: scope });

    const issues = await openIssues();
    expect(
      issues.map((issue) => [issue.kind, issue.expectedMinor, issue.actualMinor]).sort(),
    ).toEqual([
      ["provider_total_mismatch", 45_000, 12_345],
      ["stripe_amount_mismatch", 900, 901],
    ]);
    expect(h.logs.some((log) => log["msg"] === "platform billing mismatch")).toBe(true);
    const view = await h.service.getPlatformFees(user(c.adminId), c.id);
    expect(view.issues).toHaveLength(2);

    h.gateway.invoices.set(stripeId, stripe);
    h.provider.total = null;
    await h.service.reconcile({ communityIds: scope });
    expect(await openIssues()).toEqual([]);
  });
});

describe("billing account access", () => {
  it("lets admins read, only the owner change billing, and refuses members", async () => {
    const c = await community();

    const view = await h.service.getPlatformFees(user(c.adminId), c.id);
    expect(view.available).toBe(true);
    expect(view.canManage).toBe(false);
    expect(view.nextInvoiceAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    await expect(h.service.getPlatformFees(user(c.memberId), c.id)).rejects.toThrow(ForbiddenError);
    await expect(
      h.service.updateBillingEmail(user(c.adminId), c.id, { email: "a@example.test" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(h.service.startPaymentMethodSetup(user(c.adminId), c.id)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      h.service.updateBillingEmail(user(c.ownerId), c.id, { email: "not an email" }),
    ).rejects.toThrow(PaymentsValidationError);

    expect(
      await h.service.updateBillingEmail(user(c.ownerId), c.id, {
        email: " Billing@Example.test ",
      }),
    ).toEqual({ billingEmail: "billing@example.test" });
    const owner = await h.service.getPlatformFees(user(c.ownerId), c.id);
    expect(owner.canManage).toBe(true);
    expect(owner.billingEmail).toBe("billing@example.test");
  });

  it("creates the Stripe customer lazily with an idempotency key", async () => {
    const c = await community();
    await h.service.startPaymentMethodSetup(user(c.ownerId), c.id);
    await h.service.startPaymentMethodSetup(user(c.ownerId), c.id);
    const [account] = await admin.db
      .select()
      .from(platformBillingAccounts)
      .where(eq(platformBillingAccounts.communityId, c.id));
    const keys = h.gateway
      .writes("createCustomer")
      .filter((call) => call.idempotencyKey === `billing:${account?.id}:customer`);
    expect(keys).toHaveLength(1);
    expect(account?.stripeCustomerId).toMatch(/^cus_/);
  });

  it("opens card setup again after the owner renames the community address", async () => {
    const c = await community();
    await h.service.startPaymentMethodSetup(user(c.ownerId), c.id);
    await admin.db
      .update(communities)
      .set({ slug: `renamed-${c.id.slice(-12)}` })
      .where(eq(communities.id, c.id));
    await h.service.startPaymentMethodSetup(user(c.ownerId), c.id);

    const [account] = await admin.db
      .select()
      .from(platformBillingAccounts)
      .where(eq(platformBillingAccounts.communityId, c.id));
    const keys = h.gateway
      .writes("createSetupSession")
      .map((call) => call.idempotencyKey)
      .filter((key) => key?.startsWith(`billing:${account?.id}:setup:`));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("does nothing on the Community Edition", async () => {
    const edition = createBillingHarness(admin.db, communityEnv());
    const c = await community();
    await insertAccrual(admin.db, c.id, { feeMinor: 5000, occurredAt: oct(1) });

    expect(await edition.service.generateInvoices()).toMatchObject({ created: 0, pushed: 0 });
    expect((await edition.service.getPlatformFees(user(c.ownerId), c.id)).available).toBe(false);
    expect(await edition.service.isBillingSuspended(c.id)).toBe(false);
  });
});

describe("platform billing webhooks through the worker", () => {
  it("stores and queues a setup event by id, then the worker saves the card", async () => {
    const w = createBillingHarness(admin.db, cloudEnv(), { webhooks: "worker" });
    const c = await community();
    const { url } = await w.service.startPaymentMethodSetup(user(c.ownerId), c.id);
    const sessionId = url.split("/").pop() ?? "";
    w.gateway.completeSetup(sessionId, `pm_card_${c.id.slice(-6)}`);
    const [account] = await admin.db
      .select()
      .from(platformBillingAccounts)
      .where(eq(platformBillingAccounts.communityId, c.id));
    const event = signedEvent("checkout.session.completed", {
      id: sessionId,
      object: "checkout.session",
      mode: "setup",
      metadata: { cohory_community_id: c.id, cohory_billing_account_id: account?.id ?? "" },
    });
    const request = { rawBody: event.rawBody, signature: event.signature };

    const first = await w.service.handlePlatformBillingWebhook(request);
    const again = await w.service.handlePlatformBillingWebhook(request);

    expect([first, again]).toEqual([
      { status: 200, outcome: "queued" },
      { status: 200, outcome: "queued" },
    ]);
    const [stored] = await admin.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.externalEventId, event.id));
    expect(stored).toMatchObject({ connectionId: null, processedAt: null });
    expect(w.queue.billingEvents).toEqual([
      { providerEventId: stored?.id },
      { providerEventId: stored?.id },
    ]);
    expect(w.gateway.writes("setDefaultPaymentMethod")).toEqual([]);

    expect(await w.queue.runBillingWebhookJobs()).toEqual(["processed", "duplicate"]);
    expect(w.gateway.writes("retrieveEvent")).toHaveLength(1);
    expect(w.gateway.writes("setDefaultPaymentMethod")).toHaveLength(1);
    expect(await w.service.handlePlatformBillingWebhook(request)).toEqual({
      status: 200,
      outcome: "duplicate",
    });
  });
});
