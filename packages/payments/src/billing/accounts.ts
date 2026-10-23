import { createHash } from "node:crypto";

import { assertCan, type Actor } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";

import {
  PaymentsNotFoundError,
  PaymentsUnavailableError,
  PaymentsValidationError,
} from "../errors";
import { requestKey } from "../idempotency";
import { loadCommunity, parse, timeBucket, withAccess, type Runtime } from "../service/context";
import type { Invoicing } from "./invoicing";
import { minimumInvoiceMinor } from "./minimum";
import { nextInvoiceDate, periodContaining } from "./period";
import { billingEnabled, callBillingStripe, requireGateway, type BillingRuntime } from "./runtime";
import { billingEmailInputSchema, invoiceHistoryLimit, setupSessionIdSchema } from "./schemas";
import { displayStatus } from "./status";
import type { BillingAccountRecord } from "./store";
import type { PlatformFeesView } from "./views";

export interface AccountsContext {
  readonly runtime: BillingRuntime;
  readonly payments: Runtime;
  readonly invoicing: Invoicing;
}

function emailKey(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 16);
}

export function createAccountOperations({ runtime, payments, invoicing }: AccountsContext) {
  const { repo } = runtime;

  async function ownerScope(actor: Actor, communityId: string): Promise<CommunityId> {
    if (!billingEnabled(runtime)) {
      throw new PaymentsUnavailableError("COHORY_EDITION=cloud");
    }
    return withAccess(payments, actor, communityId, async ({ community, context }) => {
      assertCan(actor, "connect", "payment", context);
      return community.id;
    });
  }

  async function completeSetup(
    communityId: CommunityId,
    sessionId: string,
  ): Promise<BillingAccountRecord> {
    const gateway = requireGateway(runtime);
    const session = await callBillingStripe(runtime, "retrieve_setup_session", () =>
      gateway.retrieveSetupSession(sessionId),
    );
    const account = await repo.asBilling(communityId, (store) => store.ensureAccount());
    if (
      session.metadata["cohory_billing_account_id"] !== account.id ||
      !account.stripeCustomerId ||
      session.customerId !== account.stripeCustomerId
    ) {
      throw new PaymentsNotFoundError("connection");
    }
    if (session.status !== "complete" || !session.paymentMethodId) {
      return account;
    }
    const methodId = session.paymentMethodId;
    const customer = await callBillingStripe(runtime, "set_default_payment_method", () =>
      gateway.setDefaultPaymentMethod(
        account.stripeCustomerId ?? "",
        methodId,
        `billing:${account.id}:default-method:${methodId}`,
      ),
    );
    const updated = await repo.asBilling(communityId, (store) =>
      store.updateAccount({
        paymentMethodId: customer.defaultPaymentMethod?.id ?? methodId,
        paymentMethodLabel: (customer.defaultPaymentMethod?.label ?? "Card on file").slice(0, 80),
      }),
    );
    runtime.log({ msg: "platform billing payment method saved", communityId });
    return updated;
  }

  return {
    async getPlatformFees(actor: Actor, communityId: string): Promise<PlatformFeesView> {
      const now = runtime.now();
      const period = periodContaining(now);
      return withAccess(payments, actor, communityId, async ({ community, context }) => {
        assertCan(actor, "read", "payment", context);
        const canManage = context.role === "owner";
        return repo.asManager(community.id, async (store) => {
          const account = await store.findAccount();
          const balances = await store.balances(period.start);
          const invoices = await store.listInvoices(invoiceHistoryLimit);
          const issues = await store.listOpenIssues();
          const ownerEmail = await store.findOwnerEmail();
          return {
            available: billingEnabled(runtime) && runtime.gateway !== null,
            feeBps: runtime.env.platformFeeBps,
            periodStart: period.start,
            nextInvoiceAt: nextInvoiceDate(now),
            balances: balances.map((balance) => ({
              ...balance,
              minimumMinor: minimumInvoiceMinor(balance.currency),
            })),
            billingEmail: account?.billingEmail ?? null,
            ownerEmail: canManage ? ownerEmail : null,
            paymentMethodLabel: account?.paymentMethodLabel ?? null,
            suspended: account?.suspendedAt != null,
            canManage,
            invoices: invoices.map((invoice) => ({
              id: invoice.id,
              currency: invoice.currency,
              periodStart: invoice.periodStart,
              periodEnd: invoice.periodEnd,
              amountMinor: invoice.amountMinor,
              amountPaidMinor: invoice.amountPaidMinor,
              status: invoice.status,
              displayStatus: displayStatus(invoice.status, invoice.pastDueSince),
              number: invoice.invoiceNumber,
              hostedInvoiceUrl: invoice.hostedInvoiceUrl,
              dueAt: invoice.dueAt,
              paidAt: invoice.paidAt,
              pastDueSince: invoice.pastDueSince,
            })),
            issues,
          };
        });
      });
    },

    async updateBillingEmail(actor: Actor, communityId: string, input: unknown) {
      const id = await ownerScope(actor, communityId);
      const { email } = parse(billingEmailInputSchema, input);
      const account = await repo.asManager(id, async (store) => {
        await store.ensureAccount();
        return store.updateAccount({ billingEmail: email });
      });
      if (account.stripeCustomerId && runtime.gateway) {
        const gateway = runtime.gateway;
        await callBillingStripe(runtime, "update_customer_email", () =>
          gateway.updateCustomerEmail(
            account.stripeCustomerId ?? "",
            email,
            `billing:${account.id}:email:${emailKey(email)}`,
          ),
        );
      }
      return { billingEmail: account.billingEmail };
    },

    async startPaymentMethodSetup(actor: Actor, communityId: string): Promise<{ url: string }> {
      const id = await ownerScope(actor, communityId);
      if (!payments.env.appUrl) {
        throw new PaymentsUnavailableError("APP_URL");
      }
      const community = await loadCommunity(payments, id);
      const gateway = requireGateway(runtime);
      const account = await invoicing.ensureCustomer(id);
      const base = `${payments.env.appUrl}/c/${community.slug}/manage/payments/platform-fees`;
      const setup = {
        customerId: account.stripeCustomerId ?? "",
        currency: "usd",
        successUrl: `${base}?setup=done&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}?setup=cancel`,
        metadata: { cohory_community_id: id, cohory_billing_account_id: account.id },
      };
      const session = await callBillingStripe(runtime, "create_setup_session", () =>
        gateway.createSetupSession(
          setup,
          requestKey(`billing:${account.id}:setup:${timeBucket(runtime.now(), 10)}`, setup),
        ),
      );
      return { url: session.url };
    },

    async completePaymentMethodSetup(actor: Actor, communityId: string, sessionId: unknown) {
      const parsed = setupSessionIdSchema.safeParse(sessionId);
      if (!parsed.success) {
        throw new PaymentsValidationError([{ path: "sessionId", message: "Invalid session id" }]);
      }
      const id = await ownerScope(actor, communityId);
      const account = await completeSetup(id, parsed.data);
      return { paymentMethodLabel: account.paymentMethodLabel };
    },

    completeSetup,

    async isBillingSuspended(communityId: CommunityId): Promise<boolean> {
      if (!billingEnabled(runtime)) {
        return false;
      }
      const account = await repo.asBilling(communityId, (store) => store.findAccount());
      return account?.suspendedAt != null;
    },
  };
}

export type AccountOperations = ReturnType<typeof createAccountOperations>;
