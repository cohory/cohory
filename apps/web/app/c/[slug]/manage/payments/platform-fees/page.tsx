import { getPaymentsService } from "@cohory/payments";
import { getPlatformBillingService, type PlatformFeesView } from "@cohory/payments/billing";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatBillingDate,
  formatFeeRate,
  formatMoney,
  PlatformFeeBalances,
  PlatformInvoiceTable,
} from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { requireManagePage, type ManagePage } from "../../../../../../lib/manage/load";
import { paymentsActionFailure } from "../../../../../../lib/payments/errors";
import { BillingPanel } from "./billing-panel";

export const metadata: Metadata = { title: "Platform fees" };

const issueLabels: Record<PlatformFeesView["issues"][number]["kind"], string> = {
  stripe_amount_mismatch: "The Stripe invoice amount differs from the fees we recorded",
  ledger_amount_mismatch: "The invoice total differs from the fees we recorded",
  provider_total_mismatch: "Your payment provider reports a different total for this month",
  stripe_invoice_missing: "The invoice has not reached Stripe yet",
};

async function completeSetup(
  manage: ManagePage,
  sessionId: string | undefined,
): Promise<string | null> {
  if (!sessionId) return null;
  try {
    await getPlatformBillingService().completePaymentMethodSetup(
      manage.actor,
      manage.communityId,
      sessionId,
    );
    return null;
  } catch (error) {
    const failure = paymentsActionFailure(error, "creator");
    if (!failure) throw error;
    return failure.message;
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PlatformFeesPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/payments/platform-fees">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const manage = await requireManagePage(slug, "payments");
  const setup = firstValue(search.setup);
  const setupError =
    setup === "done" ? await completeSetup(manage, firstValue(search.session_id)) : null;
  const [view, overview] = await Promise.all([
    getPlatformBillingService().getPlatformFees(manage.actor, manage.communityId),
    getPaymentsService().getPaymentsOverview(manage.actor, manage.communityId),
  ]);
  const feeSplit = overview.connection?.feeSplit === true;
  const pastDue = view.invoices.filter((invoice) => invoice.displayStatus === "past_due");

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link
          href={`/c/${manage.slug}/manage/payments`}
          className="inline-flex min-h-11 items-center self-start text-sm text-accent underline-offset-4 hover:underline"
        >
          Back to Payments
        </Link>
        <h2 className="text-2xl font-semibold text-text">Platform fees</h2>
      </div>
      {!view.available ? (
        <Alert>
          <AlertTitle>No platform fee billing on this server</AlertTitle>
          <AlertDescription>
            Monthly platform fee invoices only apply to Cohory Cloud with a payment provider that
            can&apos;t split fees.
          </AlertDescription>
        </Alert>
      ) : null}
      {view.suspended ? (
        <Alert variant="danger">
          <AlertTitle>New paid signups are paused</AlertTitle>
          <AlertDescription>
            A platform fee invoice has been unpaid for 30 days. Existing members keep their access.
            Pay the invoice below and signups open again within a day.
          </AlertDescription>
        </Alert>
      ) : pastDue.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            {pastDue
              .map(
                (invoice) =>
                  `${formatMoney(invoice.amountMinor, invoice.currency)} is past due since ${formatBillingDate(invoice.pastDueSince ?? invoice.periodEnd)}.`,
              )
              .join(" ")}{" "}
            If it stays unpaid for 30 days, new paid signups pause. Existing members keep access.
          </AlertDescription>
        </Alert>
      ) : null}
      {setup === "done" && !setupError ? (
        <Alert variant="success">
          <AlertTitle>Card saved</AlertTitle>
          <AlertDescription>Future invoices are charged to it automatically.</AlertDescription>
        </Alert>
      ) : null}
      {feeSplit ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text">
              Your {formatFeeRate(view.feeBps)} fee is taken from each payment. There is nothing to
              pay here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">This month</CardTitle>
              <CardDescription>
                Fees build up during the month and are invoiced on the 1st.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlatformFeeBalances
                balances={view.balances}
                nextInvoiceAt={view.nextInvoiceAt}
                feeBps={view.feeBps}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Billing details</CardTitle>
              <CardDescription>
                This is the only bill Cohory sends you. Payments from your members never pass
                through Cohory.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BillingPanel
                slug={manage.slug}
                billingEmail={view.billingEmail}
                ownerEmail={view.ownerEmail}
                paymentMethodLabel={view.paymentMethodLabel}
                canManage={view.canManage && view.available}
                initialError={setupError}
              />
            </CardContent>
          </Card>
        </>
      )}
      {feeSplit && view.invoices.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invoices</CardTitle>
            <CardDescription>One invoice per month and currency, from Stripe.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlatformInvoiceTable
              rows={view.invoices.map((invoice) => ({
                id: invoice.id,
                currency: invoice.currency,
                periodStart: invoice.periodStart,
                amountMinor: invoice.amountMinor,
                status: invoice.displayStatus,
                number: invoice.number,
                hostedInvoiceUrl: invoice.hostedInvoiceUrl,
                dueAt: invoice.dueAt,
                paidAt: invoice.paidAt,
              }))}
            />
          </CardContent>
        </Card>
      )}
      {view.issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Billing checks</CardTitle>
            <CardDescription>
              Our daily check found a difference. The platform team reviews it before anything
              changes on your invoice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-text">
              {view.issues.map((issue) => (
                <li key={issue.id}>
                  {issueLabels[issue.kind]} ({issue.currency.toUpperCase()},{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(issue.periodStart)}
                  ).
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
