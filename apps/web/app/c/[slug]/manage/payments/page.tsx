import { emailSendingConfigured } from "@cohory/auth";
import { can } from "@cohory/authz";
import { getPaymentsService, type PaymentsOverview, type PlanView } from "@cohory/payments";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ExistingSubscribersCard,
  formatMoney,
  LedgerSummary,
  LedgerSummarySkeleton,
  platformFeeLine,
  SubscriptionTable,
  SubscriptionTableSkeleton,
} from "@cohory/ui";
import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CompedMembers } from "../../../../../components/payments/comped-members";
import { ConnectionPanel } from "../../../../../components/payments/connection-panel";
import { PlanEditor } from "../../../../../components/payments/plan-editor";
import { RefundPolicyForm } from "../../../../../components/payments/refund-policy-form";
import { requireManagePage, type ManagePage } from "../../../../../lib/manage/load";
import { appUrl } from "../../../../../lib/manage/views";
import { paymentsActionFailure } from "../../../../../lib/payments/errors";
import { subscribersHref } from "../../../../../lib/payments/linking";
import { supportedCurrencies } from "../../../../../lib/payments/schemas";
import { currentSession } from "../../../../../lib/session";
import {
  connectionReady,
  connectSetupRequested,
  stripeReturn,
  toSubscriptionRow,
  webhookUrl,
} from "../../../../../lib/payments/views";

export const metadata: Metadata = { title: "Payments" };

function SectionError({ title }: { title: string }) {
  return (
    <Alert variant="danger">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>Refresh the page to try again.</AlertDescription>
    </Alert>
  );
}

async function attemptLoad<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (!paymentsActionFailure(error, "creator")) throw error;
    return null;
  }
}

async function PaidMembers({ manage }: { manage: ManagePage }) {
  const items = await attemptLoad(() =>
    getPaymentsService().listSubscriptions(manage.actor, manage.communityId),
  );
  if (!items) {
    return <SectionError title="We couldn't load paid members" />;
  }
  return <SubscriptionTable rows={items.map(toSubscriptionRow)} />;
}

async function Comps({ manage, invites }: { manage: ManagePage; invites: boolean }) {
  const [items, invitations] = await Promise.all([
    attemptLoad(() => getPaymentsService().listComps(manage.actor, manage.communityId)),
    attemptLoad(() => getPaymentsService().listCompInvitations(manage.actor, manage.communityId)),
  ]);
  if (!items || !invitations) {
    return <SectionError title="We couldn't load comped members" />;
  }
  return (
    <CompedMembers
      slug={manage.slug}
      invites={invites}
      invitations={invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        note: invitation.note,
        expiresAt: invitation.expiresAt?.toISOString() ?? null,
        grantedBy: invitation.grantedByName,
      }))}
      rows={items.map((item) => ({
        id: item.id,
        name: item.userName,
        email: item.userEmail,
        note: item.note,
        expiresAt: item.expiresAt?.toISOString() ?? null,
        status: item.status,
        grantedBy: item.grantedByName,
      }))}
    />
  );
}

async function ExistingSubscribers({
  manage,
  connected,
  linking,
}: {
  manage: ManagePage;
  connected: boolean;
  linking: boolean;
}) {
  const links =
    connected && linking
      ? await attemptLoad(() =>
          getPaymentsService().listSubscriptionLinks(manage.actor, manage.communityId),
        )
      : [];
  return (
    <ExistingSubscribersCard
      href={subscribersHref(manage.slug)}
      connected={connected}
      linking={linking}
      linkedCount={links?.filter((link) => link.status === "linked").length ?? 0}
      invitedCount={links?.filter((link) => link.status === "invited").length ?? 0}
    />
  );
}

async function Totals({ manage, providerName }: { manage: ManagePage; providerName: string }) {
  const ledger = await attemptLoad(() =>
    getPaymentsService().getLedgerSummary(manage.actor, manage.communityId),
  );
  if (!ledger) {
    return <SectionError title="We couldn't load payment totals" />;
  }
  return (
    <LedgerSummary
      edition={ledger.edition}
      currencies={ledger.currencies}
      providerName={providerName}
    />
  );
}

function planPrices(plan: PlanView | null) {
  return plan
    ? {
        currency: plan.currency,
        monthlyPriceMinor: plan.monthlyPriceMinor,
        annualPriceMinor: plan.annualPriceMinor,
      }
    : null;
}

function pricingSummary(
  plan: PlanView | null,
  draft: PlanView | null,
  ready: boolean,
  providerName: string,
): string {
  if (plan) return planSummary(plan);
  if (!draft) return "Your community is free to join.";
  const next = ready
    ? "Put it on sale when you are ready."
    : `Not on sale until ${providerName} is ready.`;
  return `Draft: ${planSummary(draft)} ${next} Until then the community is free to join.`;
}

function planSummary(plan: PlanView): string {
  const monthly = `${formatMoney(plan.monthlyPriceMinor, plan.currency)} per month`;
  return plan.annualPriceMinor === null
    ? `${plan.name}. ${monthly}.`
    : `${plan.name}. ${monthly} or ${formatMoney(plan.annualPriceMinor, plan.currency)} per year.`;
}

async function refreshOnReturn(
  manage: ManagePage,
  overview: PaymentsOverview,
): Promise<{ overview: PaymentsOverview; error: string | null }> {
  if (!overview.connection?.externalAccountId) {
    return { overview, error: null };
  }
  try {
    const connection = await getPaymentsService().refreshConnection(
      manage.actor,
      manage.communityId,
    );
    return { overview: { ...overview, connection }, error: null };
  } catch (error) {
    const failure = paymentsActionFailure(error, "creator");
    if (!failure) throw error;
    return { overview, error: failure.message };
  }
}

export default async function ManagePaymentsPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/payments">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const manage = await requireManagePage(slug, "payments");
  const service = getPaymentsService();
  const returned = stripeReturn(search.stripe);
  const canEdit = can(manage.actor, "edit_plan", "payment", { role: manage.role });
  const canConnect = can(manage.actor, "connect", "payment", { role: manage.role });
  const session = await currentSession();
  const unconfirmedEmail =
    session && !session.user.emailVerified && emailSendingConfigured() ? session.user.email : null;
  const overviewLoad = service
    .getPaymentsOverview(manage.actor, manage.communityId)
    .then((loaded) =>
      returned === "return" ? refreshOnReturn(manage, loaded) : { overview: loaded, error: null },
    );
  const loadPlan = () => service.getPlan(manage.actor, manage.communityId);
  const [{ overview, error: refreshError }, plan, draft] = await Promise.all([
    overviewLoad,
    returned === "return" ? overviewLoad.then(loadPlan) : loadPlan(),
    canEdit ? service.getDraftPlan(manage.actor, manage.communityId) : null,
  ]);
  const { connection } = overview;
  const links = legalLinks(getLegalConfig(), overview.edition);
  const creatorTerms =
    links.creatorTerms && links.dpa ? { terms: links.creatorTerms, dpa: links.dpa } : null;
  const [paidMembers, ownershipReview, termsAccepted] = await Promise.all([
    connection
      ? attemptLoad(() => service.getPaidMembersSummary(manage.actor, manage.communityId))
      : null,
    connection && canConnect
      ? attemptLoad(() => service.getOwnershipReview(manage.actor, manage.communityId))
      : null,
    connection && canConnect && creatorTerms
      ? service.creatorTermsAccepted(manage.actor, manage.communityId)
      : true,
  ]);
  const disconnectRun = paidMembers?.run?.kind === "disconnect" ? paidMembers.run : null;
  const ready = connectionReady(connection);
  const providerName = connection?.providerName ?? "Stripe";
  const stripeConnection = connection === null || connection.provider !== "polar";
  const highlightConnect = canConnect && connectSetupRequested(search.setup, connection);

  return (
    <>
      <h2 className="text-2xl font-semibold text-text">Payments</h2>
      {highlightConnect ? (
        <Alert variant="info">
          <AlertTitle>Your community is ready. Next, connect payments.</AlertTitle>
          <AlertDescription>
            It stays free to join until you connect a payment account and put a plan on sale.
          </AlertDescription>
        </Alert>
      ) : null}
      {returned === "refresh" ? (
        <Alert variant="warning">
          <AlertTitle>Your Stripe link expired</AlertTitle>
          <AlertDescription>Choose Finish Stripe setup to get a new link.</AlertDescription>
        </Alert>
      ) : null}
      {overview.polarRetired ? (
        <Alert variant="warning">
          <AlertTitle>Polar is no longer offered</AlertTitle>
          <AlertDescription>
            Your Polar connection keeps syncing, but new checkouts are off. Disconnect Polar, then
            connect Stripe to keep selling memberships.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card
        className={highlightConnect ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : undefined}
      >
        <CardHeader>
          <CardTitle className="text-lg">Payment account</CardTitle>
          <CardDescription>
            Payments go to your own {connection ? providerName : "payment"} account. Members&apos;
            subscriptions live there too.{" "}
            {platformFeeLine(
              overview.edition,
              overview.platformFeeBps,
              connection ? { name: providerName, feeSplit: connection.feeSplit } : undefined,
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectionPanel
            slug={manage.slug}
            edition={overview.edition}
            providers={overview.providers}
            platformFeeBps={overview.platformFeeBps}
            canConnect={canConnect}
            unconfirmedEmail={unconfirmedEmail}
            creatorTerms={creatorTerms}
            creatorTermsOutdated={!termsAccepted}
            initialError={refreshError}
            ownershipReview={
              ownershipReview
                ? {
                    previousOwnerName: ownershipReview.previousOwnerName,
                    paying: ownershipReview.cohory + ownershipReview.linkedImports,
                  }
                : null
            }
            paidMembers={
              paidMembers
                ? {
                    cohory: paidMembers.cohory,
                    linkedImports: paidMembers.linkedImports,
                    disconnectRun: disconnectRun
                      ? {
                          status: disconnectRun.status,
                          targetCount: disconnectRun.targetCount,
                          doneCount: disconnectRun.doneCount,
                          failedCount: disconnectRun.failedCount,
                          failedMembers: disconnectRun.failedMembers.map((member) => ({
                            userId: member.userId,
                            name: member.name,
                          })),
                        }
                      : null,
                  }
                : null
            }
            connection={
              connection
                ? {
                    provider: connection.provider,
                    providerName: connection.providerName,
                    status: connection.status,
                    chargesEnabled: connection.chargesEnabled,
                    externalAccountId: connection.externalAccountId,
                    livemode: connection.livemode,
                    webhookUrl: webhookUrl(connection, appUrl()),
                    webhookSecretSaved: connection.webhookSecretSaved,
                    lastWebhookAt: connection.lastWebhookAt?.toISOString() ?? null,
                    feeBilledMonthly:
                      !connection.feeSplit &&
                      overview.edition === "cloud" &&
                      overview.platformFeeBps > 0,
                  }
                : null
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pricing</CardTitle>
          <CardDescription>
            {pricingSummary(plan, draft, ready, providerName)}
            {plan && !plan.purchasable
              ? ownershipReview
                ? ` Not on sale until you choose a ${providerName} account.`
                : ` Not on sale until ${providerName} can take payments.`
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canEdit ? (
            <p className="text-sm text-text-muted">Only the owner can change pricing.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {ownershipReview ? (
                <p className="text-sm text-text-muted">
                  You can change the price after you choose a {providerName} account.
                </p>
              ) : !ready && plan ? (
                <p className="text-sm text-text-muted">
                  You can change the price after {providerName} is ready to take payments again.
                </p>
              ) : !ready ? (
                <p className="text-sm text-text-muted">
                  Decide your price now. It stays a draft, and the community stays free to join,
                  until {providerName} is ready to take payments.
                </p>
              ) : null}
              <PlanEditor
                slug={manage.slug}
                currencies={supportedCurrencies}
                disabled={ownershipReview !== null || (plan !== null && !ready)}
                state={plan ? "on_sale" : draft ? "draft" : "none"}
                canSell={ready}
                payingCount={paidMembers?.cohory ?? 0}
                platformFeeBps={overview.edition === "cloud" ? overview.platformFeeBps : 0}
                providerName={providerName}
                plan={planPrices(plan ?? draft)}
              />
              {can(manage.actor, "update", "settings", { role: manage.role }) ? (
                <RefundPolicyForm slug={manage.slug} initial={manage.page.community.refundPolicy} />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Paid members</CardTitle>
          <CardDescription>
            Statuses come from {providerName} and update automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<SubscriptionTableSkeleton />}>
            <PaidMembers manage={manage} />
          </Suspense>
        </CardContent>
      </Card>
      {plan && can(manage.actor, "grant_comp", "membership", { role: manage.role }) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Free access</CardTitle>
            <CardDescription>
              Give someone a free membership, for example a guest speaker or a team member. They get
              the same access as a paying member, without a paid subscription.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<SubscriptionTableSkeleton />}>
              <Comps manage={manage} invites={overview.edition === "cloud"} />
            </Suspense>
          </CardContent>
        </Card>
      ) : null}
      {stripeConnection &&
      can(manage.actor, "link_subscriptions", "payment", { role: manage.role }) ? (
        <Suspense fallback={<SubscriptionTableSkeleton />}>
          <ExistingSubscribers
            manage={manage}
            connected={connection?.externalAccountId != null}
            linking={overview.edition === "community"}
          />
        </Suspense>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment totals</CardTitle>
          <CardDescription>All time, per currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<LedgerSummarySkeleton />}>
            <Totals manage={manage} providerName={providerName} />
          </Suspense>
        </CardContent>
      </Card>
      {overview.edition === "cloud" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Platform fees</CardTitle>
            <CardDescription>
              Stripe Connect fees are collected when each payment is made. Fees on payment providers
              that can&apos;t split them are invoiced monthly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/c/${manage.slug}/manage/payments/platform-fees`}
              className="inline-flex min-h-11 items-center text-sm text-accent underline-offset-4 hover:underline"
            >
              See platform fees and invoices
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
