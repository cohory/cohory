import { getEntitlementsService } from "@cohory/api/services";
import {
  getPaymentsService,
  PaymentsError,
  type ClaimResult,
  type MyCompInvitations,
} from "@cohory/payments";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  formatBillingDate,
  MembershipStatus,
} from "@cohory/ui";
import { Ban } from "lucide-react";
import type { Actor } from "@cohory/authz";
import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "../../../../components/empty-state";
import { StepList } from "../../../../components/feed/welcome-card";
import { JoinButton } from "../../../../components/join-button";
import { AgentLicenseNote } from "../../../../components/payments/agent-license-note";
import { CheckoutPending } from "../../../../components/payments/checkout-pending";
import { CompOffer } from "../../../../components/payments/comp-offer";
import { MembershipPanel } from "../../../../components/payments/membership-panel";
import { ResubscribePrompt } from "../../../../components/payments/resubscribe-prompt";
import { withNext } from "../../../../lib/auth/form-links";
import { loadNextForViewer } from "../../../../lib/calendar/load";
import { signUpOfferedFor } from "../../../../lib/communities/join-intent";
import { loadAboutBody, loadSellerName } from "../../../../lib/communities/about";
import { loadCommunityPage, type CommunityPage } from "../../../../lib/communities/load";
import { loadContinueLearning } from "../../../../lib/courses/load";
import { loadWelcomeSteps } from "../../../../lib/onboarding/load";
import { introduceHref, type WelcomeStep } from "../../../../lib/onboarding/welcome";
import { loadActivePlan } from "../../../../lib/payments/load";
import {
  billingClosedNotice,
  checkoutReturn,
  membershipHref,
  membershipPageState,
  pausedReturn,
} from "../../../../lib/payments/views";

export const metadata: Metadata = { title: "Membership" };

const linkClass =
  "rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

async function claimMoved(actor: Actor, communityId: string): Promise<ClaimResult | null> {
  if (actor.kind !== "user") {
    return null;
  }
  try {
    return await getPaymentsService().claimInvitedSubscriptions(actor, communityId);
  } catch (error) {
    if (error instanceof PaymentsError) return null;
    throw error;
  }
}

async function compOffers(actor: Actor, communityId: string): Promise<MyCompInvitations | null> {
  if (actor.kind !== "user") {
    return null;
  }
  try {
    return await getPaymentsService().listMyCompInvitations(actor, communityId);
  } catch (error) {
    if (error instanceof PaymentsError) return null;
    throw error;
  }
}

// Invitations to free access or a moved subscription link here, and the email cannot know
// whether the person already has an account.
function SignedOutChoices({ actor, slug }: { actor: Actor; slug: string }) {
  if (actor.kind === "user") return null;
  const next = membershipHref(slug);
  return (
    <Alert variant="info" className="max-w-xl">
      <AlertTitle>Already a member or invited?</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>Sign in with the email address your membership or invitation uses.</span>
        <span className="flex flex-wrap gap-3">
          <Button asChild className="min-h-11">
            <Link href={withNext("/sign-in", next)}>Sign in</Link>
          </Button>
          {signUpOfferedFor(getPlatformConfig().signUpMode, next) ? (
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={withNext("/sign-up", next)}>Create an account</Link>
            </Button>
          ) : null}
        </span>
      </AlertDescription>
    </Alert>
  );
}

async function welcomeAfterCheckout(page: CommunityPage): Promise<WelcomeStep[] | null> {
  if (page.access !== "full") return null;
  const [learning, next] = await Promise.all([loadContinueLearning(page), loadNextForViewer(page)]);
  return loadWelcomeSteps(page, learning, next);
}

export default async function MembershipPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/membership">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const page = await loadCommunityPage(slug);
  const { community, actor } = page;
  const planLoad = loadActivePlan(community.id);
  const [claim, plan, licenses] = await Promise.all([
    claimMoved(actor, community.id),
    planLoad,
    planLoad.then((active) =>
      active ? getEntitlementsService().listAgentLicenses(community.id) : [],
    ),
  ]);
  const [offers, mine, about, seller] = await Promise.all([
    compOffers(actor, community.id),
    actor.kind === "user" ? getPaymentsService().getMyMembership(actor, community.id) : null,
    plan ? loadAboutBody(community.slug) : null,
    plan ? loadSellerName(community.slug) : null,
  ]);
  const links = legalLinks(getLegalConfig(), getPlatformConfig().edition);
  const offer = offers?.invitations[0] ?? null;
  const state = membershipPageState(plan, mine, { inviteOnly: community.joinMode === "invite" });
  const agentLicenses = state.kind === "buy" ? licenses : [];
  const providerName = plan?.providerName ?? mine?.provider?.name ?? "Stripe";
  const returned = checkoutReturn(search.checkout);
  const pausedUntil = pausedReturn(search.paused);
  const home = `/c/${community.slug}`;
  const welcome =
    returned === "success" && state.kind === "subscribed" ? await welcomeAfterCheckout(page) : null;
  const cardPlan = plan
    ? {
        name: plan.name,
        currency: plan.currency,
        monthlyPriceMinor: plan.monthlyPriceMinor,
        annualPriceMinor: plan.annualPriceMinor,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold text-text">Membership</h2>
      <SignedOutChoices actor={actor} slug={community.slug} />
      {claim && claim.claimed > 0 ? (
        <Alert variant="success">
          <AlertTitle>Your membership has moved</AlertTitle>
          <AlertDescription>
            Your existing subscription is linked to this community. You have access now, and your
            price, card, and renewal date stay the same.
          </AlertDescription>
        </Alert>
      ) : null}
      {claim?.waitingForVerification ? (
        <Alert variant="info">
          <AlertTitle>Confirm your email to get your membership</AlertTitle>
          <AlertDescription>
            We found your existing subscription. Open the confirmation email we sent you, then come
            back to this page.
          </AlertDescription>
        </Alert>
      ) : null}
      {offer ? (
        <CompOffer
          slug={community.slug}
          communityName={community.name}
          invitationId={offer.id}
          expiresAt={offer.expiresAt?.toISOString() ?? null}
        />
      ) : null}
      {offers?.waitingForVerification ? (
        <Alert variant="info">
          <AlertTitle>Confirm your email to accept free access</AlertTitle>
          <AlertDescription>
            {community.name} offers you free access. Open the confirmation email we sent you, then
            come back to this page.
          </AlertDescription>
        </Alert>
      ) : null}
      {returned === "cancel" && state.kind === "buy" ? (
        <Alert variant="info">
          <AlertTitle>Checkout canceled</AlertTitle>
          <AlertDescription>
            You haven&apos;t been charged. Join whenever you&apos;re ready.
          </AlertDescription>
        </Alert>
      ) : null}
      {returned === "success" && state.kind === "subscribed" ? (
        <Alert variant="success">
          <AlertTitle>You&apos;re in</AlertTitle>
          <AlertDescription>
            Welcome to {community.name}. {providerName} emails your receipt.
          </AlertDescription>
        </Alert>
      ) : null}
      {welcome ? (
        <section aria-labelledby="checkout-start-here" className="flex max-w-xl flex-col gap-2">
          <h3 id="checkout-start-here" className="text-lg font-semibold text-text">
            Start here
          </h3>
          <StepList steps={welcome} />
        </section>
      ) : null}
      {returned === "success" && state.kind === "buy" ? <CheckoutPending /> : null}
      {pausedUntil && state.kind === "subscribed" && state.status === "paused" ? (
        <Alert variant="success">
          <AlertTitle>Payments paused</AlertTitle>
          <AlertDescription>
            Payments start again on {formatBillingDate(pausedUntil)}. You can resume them sooner
            from this page.
          </AlertDescription>
        </Alert>
      ) : null}
      {mine?.resubscribe && plan?.purchasable ? (
        <ResubscribePrompt
          slug={community.slug}
          endsAt={mine.resubscribe.endsAt}
          interval={
            mine.subscription?.interval === "year" && plan.annualPriceMinor !== null
              ? "year"
              : "month"
          }
        />
      ) : null}
      {mine?.canRejoin ? (
        <div className="flex max-w-xl flex-col gap-3">
          <Alert variant="info">
            <AlertTitle>You left {community.name}</AlertTitle>
            <AlertDescription className="text-text">
              Your paid membership is still active, so you can join again without paying.
            </AlertDescription>
          </Alert>
          <JoinButton slug={community.slug} label="Join again" />
        </div>
      ) : null}
      {state.kind === "banned" ? (
        <EmptyState icon={Ban} title="You can't join this community" />
      ) : null}
      {state.kind === "invite_only" ? (
        <Alert variant="info" className="max-w-xl">
          <AlertTitle>Invite only</AlertTitle>
          <AlertDescription className="text-text">
            New members join {community.name} with an invite link. Ask a member to share one.
          </AlertDescription>
        </Alert>
      ) : null}
      {state.kind === "staff" ? <MembershipStatus kind="staff" className="max-w-xl" /> : null}
      {state.kind === "free_member" ? <MembershipStatus kind="free" className="max-w-xl" /> : null}
      {state.kind === "buy" || state.kind === "subscribed" || state.kind === "free_community" ? (
        <MembershipPanel
          slug={community.slug}
          plan={cardPlan}
          state={state}
          providerName={providerName}
          features={about?.whatYouGet}
          checkout={{
            seller,
            refundPolicy: community.refundPolicy,
            termsHref: links.terms,
            privacyHref: links.privacy,
          }}
          questions={(mine?.asksJoinQuestions ?? true) ? community.joinQuestions : []}
          billingClosed={billingClosedNotice(community.name, mine)}
          archived={
            mine?.communityArchived ??
            ("archivedAt" in community ? community.archivedAt !== null : false)
          }
        />
      ) : null}
      {state.kind === "buy" ? (
        <AgentLicenseNote licenses={agentLicenses.map((listing) => listing.license)} />
      ) : null}
      {state.kind === "free_community" && page.access === "full" && page.canJoin ? (
        <JoinButton slug={community.slug} />
      ) : null}
      {state.kind === "subscribed" && returned === "success" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild className="min-h-11">
            <Link href={introduceHref(community.slug)}>Introduce yourself</Link>
          </Button>
          <Link href={home} className={`text-sm ${linkClass}`}>
            Go to the community
          </Link>
        </div>
      ) : (
        <Link href={home} className={`self-start text-sm ${linkClass}`}>
          Back to {community.name}
        </Link>
      )}
    </div>
  );
}
