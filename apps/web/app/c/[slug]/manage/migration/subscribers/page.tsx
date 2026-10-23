import { can } from "@cohory/authz";
import { getMigrationService, type MigrationJobView } from "@cohory/migration";
import { getPaymentsService, type SubscriberDiscovery } from "@cohory/payments";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  formatBillingDate,
  formatFeeRate,
} from "@cohory/ui";
import { UsersRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SubscriberLinker } from "../../../../../../components/payments/subscriber-linker";
import { requireManagePage, type ManagePage } from "../../../../../../lib/manage/load";
import { paymentsActionFailure } from "../../../../../../lib/payments/errors";
import { initialChoices, subscribersHref, toLinkRow } from "../../../../../../lib/payments/linking";
import {
  freeUntilText,
  importedMoves,
  moveStateLabels,
  notYetListed,
} from "../../../../../../lib/payments/moving";
import { AddImportedMoves, AddMovesForm, RemindMoves } from "./moving-members";

export const metadata: Metadata = { title: "Bring your existing subscribers" };

const cursorPattern = /^sub_[A-Za-z0-9_]+$/;

const linkClass =
  "rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function Limits() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">What linking does</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-2 pl-5 text-sm text-text">
          <li>
            Members keep paying on the same Stripe subscription, at the same price and renewal date.
            Nobody is charged again and no card details move.
          </li>
          <li>
            We match each subscription to a member by the email on the Stripe customer. People
            without an account, or with an email they haven&apos;t confirmed, get an email to sign
            up. Their access starts once they confirm that email.
          </li>
          <li>
            After linking, members manage and cancel billing from their membership page in this
            community. Changes you make in the Stripe Dashboard still reach Cohory.
          </li>
          <li>
            Subscriptions that another platform created on your account can&apos;t be linked. Add
            those members to Paying members to move below.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

async function loadDiscovery(
  manage: ManagePage,
  cursor: string | null,
): Promise<{ discovery: SubscriberDiscovery | null; error: string | null }> {
  try {
    return {
      discovery: await getPaymentsService().discoverSubscriptions(
        manage.actor,
        manage.communityId,
        { cursor },
      ),
      error: null,
    };
  } catch (error) {
    const failure = paymentsActionFailure(error, "creator");
    if (!failure) throw error;
    return { discovery: null, error: failure.message };
  }
}

async function migrationJobs(manage: ManagePage): Promise<MigrationJobView[]> {
  try {
    return await getMigrationService().listJobs(manage.actor, manage.communityId);
  } catch (error) {
    if (paymentsActionFailure(error, "creator")) return [];
    throw error;
  }
}

async function MovingMembers({ manage }: { manage: ManagePage }) {
  const [moves, jobs] = await Promise.all([
    getPaymentsService().listSubscriberMoves(manage.actor, manage.communityId),
    migrationJobs(manage),
  ]);
  const imported = importedMoves(jobs.flatMap((job) => (job.kind === "import" ? [job] : [])));
  const missing = notYetListed(imported, moves);
  const waiting = moves.filter((move) => move.state !== "moved").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Paying members to move</CardTitle>
        <CardDescription>
          People who paid you somewhere else start a new subscription here. They aren&apos;t charged
          before their free until date, usually their old renewal date, so nobody pays twice. Once
          someone has moved, cancel their old subscription.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {imported && missing > 0 ? (
          <AddImportedMoves
            slug={manage.slug}
            jobId={imported.jobId}
            count={missing}
            from={imported.from}
          />
        ) : null}
        <AddMovesForm slug={manage.slug} />
        {moves.length > 0 ? (
          <>
            <ul aria-label="Paying members to move" className="flex flex-col">
              {moves.map((move) => (
                <li
                  key={move.id}
                  className="flex flex-wrap justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0"
                >
                  <span className="truncate text-text" title={move.email}>
                    {move.email}
                  </span>
                  <span className="text-text-muted">
                    {moveStateLabels[move.state]}
                    {move.state === "moved"
                      ? ""
                      : `. ${freeUntilText(move.freeUntil, formatBillingDate)}`}
                    {move.remindedAt && move.state !== "moved"
                      ? `. Emailed ${formatBillingDate(move.remindedAt)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
            {waiting > 0 ? <RemindMoves slug={manage.slug} /> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function ExistingSubscribersPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/migration/subscribers">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const manage = await requireManagePage(slug, "migration");
  if (!can(manage.actor, "link_subscriptions", "payment", { role: manage.role })) {
    notFound();
  }
  const after =
    typeof search.after === "string" && cursorPattern.test(search.after) ? search.after : null;
  const service = getPaymentsService();
  const overview = await service.getPaymentsOverview(manage.actor, manage.communityId);
  const linking = overview.edition === "community";
  const connected = overview.connection?.externalAccountId != null;
  const [{ discovery, error }, links] =
    linking && connected
      ? await Promise.all([
          loadDiscovery(manage, after),
          service.listSubscriptionLinks(manage.actor, manage.communityId),
        ])
      : [{ discovery: null, error: null }, []];
  const invited = links.filter((link) => link.status === "invited");
  const base = subscribersHref(manage.slug);
  const linkable = discovery?.rows.filter((row) => row.block === null).length ?? 0;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link
          href={`/c/${manage.slug}/manage/migration`}
          className={`self-start text-sm ${linkClass}`}
        >
          Back to Migration
        </Link>
        <h2 className="text-2xl font-semibold text-text">Bring your existing subscribers</h2>
        <p className="text-sm text-text-muted">
          {linking
            ? `Link subscriptions that already run on your Stripe account to members of ${manage.page.community.name}, so they get access without paying again.`
            : `Existing subscriptions can't be linked on this server. Paying members start a new subscription in ${manage.page.community.name}, with free time until their old renewal date.`}
        </p>
      </div>
      {linking ? <Limits /> : null}
      {linking && !connected ? (
        <Alert variant="info">
          <AlertTitle>Connect Stripe first</AlertTitle>
          <AlertDescription>
            Connect the Stripe account that holds your subscriptions on the{" "}
            <Link href={`/c/${manage.slug}/manage/payments`} className={linkClass}>
              Payments
            </Link>{" "}
            page, then come back here.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertTitle>We couldn&apos;t read your Stripe subscriptions</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {discovery ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Subscriptions on your Stripe account</CardTitle>
            <CardDescription>
              Active, trial, and past due subscriptions. Check the action for each one, then link
              them.
              {discovery.plan
                ? ` They count as members of ${discovery.plan.name}.`
                : " Add a price on the Payments page so new members can join too."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {discovery.rows.length === 0 ? (
              <EmptyState
                icon={<UsersRoundIcon />}
                title="No subscriptions to link"
                description="Stripe has no active, trial, or past due subscriptions on this account."
              />
            ) : (
              <>
                <p className="text-sm text-text-muted">
                  {linkable} of {discovery.rows.length} on this page can be linked or invited.
                </p>
                <SubscriberLinker
                  key={after ?? "first"}
                  slug={manage.slug}
                  rows={discovery.rows.map(toLinkRow)}
                  initialChoices={initialChoices(discovery.rows)}
                  platformFee={
                    discovery.canAddPlatformFee
                      ? { label: formatFeeRate(discovery.platformFeeBps) }
                      : null
                  }
                />
              </>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              {after ? (
                <Link href={base} className={linkClass}>
                  First page
                </Link>
              ) : null}
              {discovery.nextCursor ? (
                <Link
                  href={`${base}?after=${encodeURIComponent(discovery.nextCursor)}`}
                  className={linkClass}
                >
                  Next page
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {invited.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Waiting for sign up</CardTitle>
            <CardDescription>
              These people get access when they sign up and confirm this email address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {invited.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0"
                >
                  <span className="truncate text-text" title={link.email}>
                    {link.email}
                  </span>
                  <span className="text-text-muted">
                    Invited {formatBillingDate(link.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <MovingMembers manage={manage} />
    </>
  );
}
