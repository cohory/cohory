import { getPlatformConfig } from "@cohory/config/platform";
import { newId, type CommunityId } from "@cohory/db";
import {
  communityEmailBrand,
  platformBillingPausedEmail,
  platformInvoicePaymentFailedEmail,
} from "@cohory/email";

import { StripeRejectedError } from "../errors";
import type { BillingInvoice } from "./gateway";
import { minimumInvoiceMinor } from "./minimum";
import { closedPeriod, periodKey, type BillingPeriod } from "./period";
import {
  billingEnabled,
  callBillingStripe,
  periodLabel,
  requireGateway,
  type BillingRuntime,
} from "./runtime";
import { invoiceStatusOf, suspensionDue } from "./status";
import type { BillingAccountRecord, BillingStore, PlatformInvoiceRecord } from "./store";

export const sendInvoiceDaysUntilDue = 14;

export interface InvoiceRunResult {
  readonly period: string;
  readonly created: number;
  readonly carriedForward: number;
  readonly pushed: number;
  readonly failed: number;
}

type EmailKind = "payment_failed" | "paused";

const templates = {
  payment_failed: platformInvoicePaymentFailedEmail,
  paused: platformBillingPausedEmail,
} as const;

export function createInvoicing(runtime: BillingRuntime) {
  const { repo } = runtime;

  async function emailOwner(
    store: BillingStore,
    account: BillingAccountRecord,
    invoice: PlatformInvoiceRecord,
    kind: EmailKind,
  ): Promise<void> {
    const to = account.billingEmail ?? (await store.findOwnerEmail());
    if (!to || !invoice.hostedInvoiceUrl) {
      return;
    }
    const community = await repo.findCommunity(store.communityId);
    const appUrl = runtime.env.appUrl;
    const content = templates[kind]({
      communityName: community?.name ?? "Your community",
      communityBrand: communityEmailBrand(community?.appearance),
      periodLabel: periodLabel(invoice.periodStart),
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      url: invoice.hostedInvoiceUrl,
      billingUrl:
        community && appUrl
          ? `${appUrl}/c/${community.slug}/manage/payments/platform-fees`
          : invoice.hostedInvoiceUrl,
    });
    try {
      await runtime.sendEmail({ to, ...content });
    } catch (error: unknown) {
      runtime.log({
        msg: "platform billing email failed",
        level: "warn",
        invoiceId: invoice.id,
        kind,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  async function ensureCustomer(communityId: CommunityId): Promise<BillingAccountRecord> {
    const account = await repo.asBilling(communityId, (store) => store.ensureAccount());
    if (account.stripeCustomerId) {
      return account;
    }
    const gateway = requireGateway(runtime);
    const { email, name } = await repo.asBilling(communityId, async (store) => ({
      email: account.billingEmail ?? (await store.findOwnerEmail()),
      name:
        (await repo.findCommunity(communityId))?.name ??
        `${getPlatformConfig().instance.name} community`,
    }));
    const customer = await callBillingStripe(runtime, "create_customer", () =>
      gateway.createCustomer(
        {
          name,
          email,
          metadata: { cohory_community_id: communityId, cohory_billing_account_id: account.id },
        },
        `billing:${account.id}:customer`,
      ),
    );
    return repo.asBilling(communityId, (store) =>
      store.updateAccount({ stripeCustomerId: customer.id }),
    );
  }

  async function refreshSuspension(
    store: BillingStore,
    account: BillingAccountRecord,
    now: Date,
  ): Promise<void> {
    const pastDue = await store.pastDueInvoices();
    const overdue = pastDue.find((invoice) => suspensionDue(invoice.pastDueSince, now));
    if (overdue && !account.suspendedAt) {
      const updated = await store.updateAccount({ suspendedAt: now });
      runtime.log({
        msg: "platform billing suspended paid signups",
        level: "warn",
        communityId: store.communityId,
        invoiceId: overdue.id,
      });
      await emailOwner(store, updated, overdue, "paused");
      return;
    }
    if (!overdue && account.suspendedAt) {
      await store.updateAccount({ suspendedAt: null });
      runtime.log({ msg: "platform billing resumed paid signups", communityId: store.communityId });
    }
  }

  async function applyInvoiceState(
    communityId: CommunityId,
    invoiceId: string,
    stripe: BillingInvoice,
    options: { paymentFailed: boolean },
  ): Promise<PlatformInvoiceRecord | null> {
    const now = runtime.now();
    return repo.asBilling(communityId, async (store) => {
      const current = await store.findInvoice(invoiceId);
      if (!current) {
        return null;
      }
      const status = invoiceStatusOf(stripe.status);
      const overdue = stripe.dueAt !== null && stripe.dueAt.getTime() <= now.getTime();
      const failed =
        options.paymentFailed ||
        (current.collectionMethod === "charge_automatically" && stripe.attemptCount > 0);
      const pastDueSince =
        status === "open" && (failed || overdue)
          ? (current.pastDueSince ?? now)
          : current.pastDueSince;
      const updated = await store.updateInvoice(invoiceId, {
        status,
        stripeInvoiceId: stripe.id,
        amountPaidMinor: stripe.amountPaidMinor,
        invoiceNumber: stripe.number,
        hostedInvoiceUrl: stripe.hostedInvoiceUrl ?? current.hostedInvoiceUrl,
        dueAt: stripe.dueAt,
        finalizedAt: stripe.finalizedAt ?? current.finalizedAt,
        paidAt: stripe.paidAt ?? current.paidAt,
        voidedAt: status === "void" ? (current.voidedAt ?? now) : current.voidedAt,
        pastDueSince,
      });
      const account = await store.ensureAccount();
      if (status === "open" && pastDueSince && !current.ownerNotifiedAt) {
        await emailOwner(store, account, updated, "payment_failed");
        await store.updateInvoice(invoiceId, { ownerNotifiedAt: now });
        runtime.log({
          msg: "platform invoice past due",
          level: "warn",
          communityId,
          invoiceId,
          stripeInvoiceId: stripe.id,
        });
      }
      if (current.status !== status) {
        runtime.log({
          msg: "platform invoice status changed",
          communityId,
          invoiceId,
          stripeInvoiceId: stripe.id,
          from: current.status,
          to: status,
        });
      }
      await refreshSuspension(store, account, now);
      return updated;
    });
  }

  async function pushInvoice(communityId: CommunityId, invoiceId: string): Promise<void> {
    const gateway = requireGateway(runtime);
    const account = await ensureCustomer(communityId);
    const invoice = await repo.asBilling(communityId, (store) => store.findInvoice(invoiceId));
    if (!invoice || !account.stripeCustomerId || invoice.status !== "draft") {
      return;
    }
    const key = `platform-invoice:${invoice.id}`;
    let stripe = invoice.stripeInvoiceId
      ? await callBillingStripe(runtime, "retrieve_invoice", () =>
          gateway.retrieveInvoice(invoice.stripeInvoiceId ?? ""),
        )
      : await callBillingStripe(runtime, "create_invoice", () =>
          gateway.createInvoice(
            {
              customerId: account.stripeCustomerId ?? "",
              currency: invoice.currency,
              amountMinor: invoice.amountMinor,
              description: `${getPlatformConfig().instance.name} platform fee, ${periodLabel(invoice.periodStart)} (${invoice.currency.toUpperCase()})`,
              collectionMethod: invoice.collectionMethod,
              daysUntilDue: sendInvoiceDaysUntilDue,
              metadata: {
                cohory_platform_invoice_id: invoice.id,
                cohory_community_id: communityId,
                cohory_period: periodKey({ start: invoice.periodStart, end: invoice.periodEnd }),
              },
            },
            key,
          ),
        );
    await repo.asBilling(communityId, (store) =>
      store.updateInvoice(invoice.id, { stripeInvoiceId: stripe.id }),
    );
    if (stripe.status === "draft") {
      stripe = await callBillingStripe(runtime, "finalize_invoice", () =>
        gateway.finalizeInvoice(stripe.id, `${key}:finalize`),
      );
    }
    let paymentFailed = false;
    if (stripe.status === "open" && invoice.collectionMethod === "send_invoice") {
      stripe = await callBillingStripe(runtime, "send_invoice", () =>
        gateway.sendInvoice(stripe.id, `${key}:send`),
      );
    }
    if (stripe.status === "open" && invoice.collectionMethod === "charge_automatically") {
      try {
        stripe = await callBillingStripe(runtime, "pay_invoice", () =>
          gateway.payInvoice(stripe.id, `${key}:pay`),
        );
      } catch (error: unknown) {
        if (!(error instanceof StripeRejectedError)) {
          throw error;
        }
        paymentFailed = true;
        stripe = await gateway.retrieveInvoice(stripe.id);
      }
    }
    const updated = await applyInvoiceState(communityId, invoice.id, stripe, { paymentFailed });
    runtime.log({
      msg: "platform invoice issued",
      communityId,
      invoiceId: invoice.id,
      stripeInvoiceId: stripe.id,
      status: updated?.status ?? null,
      currency: invoice.currency,
      amountMinor: invoice.amountMinor,
    });
  }

  async function generateInvoices(
    input: {
      readonly now?: Date;
      readonly period?: BillingPeriod;
      readonly communityIds?: readonly CommunityId[];
    } = {},
  ): Promise<InvoiceRunResult> {
    const period = input.period ?? closedPeriod(input.now ?? runtime.now());
    const result = {
      period: periodKey(period),
      created: 0,
      carriedForward: 0,
      pushed: 0,
      failed: 0,
    };
    if (!billingEnabled(runtime)) {
      return result;
    }
    requireGateway(runtime);
    const balances = await repo.listBillableBalances(period.end, input.communityIds);
    for (const balance of balances) {
      const outcome = await repo.asBilling(balance.communityId, async (store) => {
        const account = await store.ensureAccount();
        return store.createInvoice({
          billingAccountId: account.id,
          currency: balance.currency,
          periodStart: period.start,
          periodEnd: period.end,
          collectionMethod: account.paymentMethodId ? "charge_automatically" : "send_invoice",
          minimumMinor: minimumInvoiceMinor(balance.currency),
        });
      });
      if (outcome.kind === "created") {
        result.created += 1;
      }
      if (outcome.kind === "below_minimum") {
        result.carriedForward += 1;
        runtime.log({
          msg: "platform fee carried forward",
          communityId: balance.communityId,
          currency: balance.currency,
          balanceMinor: outcome.balanceMinor,
          period: result.period,
        });
      }
    }
    for (const ref of await repo.listUnsettledInvoices(input.communityIds)) {
      const draft = await repo.asBilling(ref.communityId, (store) =>
        store.findInvoice(ref.invoiceId),
      );
      if (draft?.status !== "draft") {
        continue;
      }
      try {
        await pushInvoice(ref.communityId, ref.invoiceId);
        result.pushed += 1;
      } catch (error: unknown) {
        result.failed += 1;
        runtime.log({
          msg: "platform invoice could not be issued",
          level: "error",
          communityId: ref.communityId,
          invoiceId: ref.invoiceId,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return result;
  }

  async function syncInvoice(communityId: CommunityId, invoiceId: string, paymentFailed = false) {
    const invoice = await repo.asBilling(communityId, (store) => store.findInvoice(invoiceId));
    if (!invoice?.stripeInvoiceId) {
      return invoice;
    }
    const gateway = requireGateway(runtime);
    const stripeId = invoice.stripeInvoiceId;
    const stripe = await callBillingStripe(runtime, "retrieve_invoice", () =>
      gateway.retrieveInvoice(stripeId),
    );
    return applyInvoiceState(communityId, invoiceId, stripe, { paymentFailed });
  }

  async function voidInvoice(communityId: CommunityId, invoiceId: string) {
    const gateway = requireGateway(runtime);
    const invoice = await repo.asBilling(communityId, (store) => store.findInvoice(invoiceId));
    if (!invoice?.stripeInvoiceId) {
      return null;
    }
    const stripeId = invoice.stripeInvoiceId;
    const stripe = await callBillingStripe(runtime, "void_invoice", () =>
      gateway.voidInvoice(stripeId, `platform-invoice:${invoice.id}:void`),
    );
    return applyInvoiceState(communityId, invoiceId, stripe, { paymentFailed: false });
  }

  async function resendInvoice(communityId: CommunityId, invoiceId: string) {
    const invoice = await syncInvoice(communityId, invoiceId);
    const stripeId = invoice?.stripeInvoiceId;
    if (!invoice || !stripeId || invoice.status !== "open") {
      return invoice;
    }
    const gateway = requireGateway(runtime);
    await callBillingStripe(runtime, "send_invoice", () =>
      gateway.sendInvoice(stripeId, `platform-invoice:${invoice.id}:resend:${newId()}`),
    );
    return invoice;
  }

  return {
    ensureCustomer,
    applyInvoiceState,
    pushInvoice,
    generateInvoices,
    syncInvoice,
    voidInvoice,
    resendInvoice,
  };
}

export type Invoicing = ReturnType<typeof createInvoicing>;
