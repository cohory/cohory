"use server";

import type { Actor } from "@cohory/authz";
import { getCommunitiesService } from "@cohory/communities";
import { CreatorTermsRequiredError, getPaymentsService, type PlanView } from "@cohory/payments";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { actorFor } from "../actor";
import { recordExitQuietly } from "../feedback/service";
import { failure, type ActionResult } from "../posts/errors";
import { requireCurrentSession } from "../session";
import { paymentsActionFailure, type PaymentsAudience } from "./errors";
import {
  billingPortalActionSchema,
  cancelMembershipActionSchema,
  checkoutActionSchema,
  pauseMembershipActionSchema,
  connectProviderActionSchema,
  ownKeysActionSchema,
  providerSecretActionSchema,
  redirectUrlSchema,
  savePlanActionSchema,
  slugActionSchema,
  connectStripeActionSchema,
  disconnectActionSchema,
  type BillingPortalActionInput,
  type CancelMembershipActionInput,
  type PauseMembershipActionInput,
  type ConnectStripeActionInput,
  type DisconnectActionInput,
  type CheckoutActionInput,
  type ConnectProviderActionInput,
  type OwnKeysActionInput,
  type ProviderSecretActionInput,
  type SavePlanActionInput,
  type SlugActionInput,
} from "./schemas";
import { membershipHref } from "./views";

type Failure = { ok: false; message: string };

interface Target {
  readonly actor: Actor;
  readonly communityId: string;
  readonly slug: string;
}

function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | Failure {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check what you entered and try again.");
  }
  return { ok: true, data: parsed.data };
}

async function attempt<T>(
  audience: PaymentsAudience,
  slug: string,
  returnTo: string,
  fn: (target: Target) => Promise<T>,
): Promise<{ ok: true; data: T; slug: string } | Failure> {
  const actor = actorFor(await requireCurrentSession(returnTo));
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
    const target = { actor, communityId: community.id, slug: community.slug };
    return { ok: true, data: await fn(target), slug: target.slug };
  } catch (error) {
    const result = paymentsActionFailure(error, audience);
    if (result) return result;
    throw error;
  }
}

function externalUrl(url: string): string {
  return redirectUrlSchema.parse(url);
}

function managePaymentsPath(slug: string): string {
  return `/c/${slug}/manage/payments`;
}

export async function startCheckoutAction(input: CheckoutActionInput): Promise<Failure> {
  const parsed = parseInput(checkoutActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, interval, answers } = parsed.data;
  const result = await attempt("member", slug, membershipHref(slug), (target) =>
    getPaymentsService().createCheckoutSession(target.actor, target.communityId, {
      interval,
      answers,
    }),
  );
  if (!result.ok) return result;
  redirect(externalUrl(result.data.url));
}

export async function openBillingPortalAction(input: BillingPortalActionInput): Promise<Failure> {
  const parsed = parseInput(billingPortalActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, returnTo } = parsed.data;
  const result = await attempt(
    "member",
    slug,
    returnTo === "account" ? "/account/billing" : membershipHref(slug),
    (target) =>
      getPaymentsService().createPortalSession(target.actor, target.communityId, { returnTo }),
  );
  if (!result.ok) return result;
  redirect(externalUrl(result.data.url));
}

export type ConnectStripeFailure = Failure & { creatorTermsRequired?: true };

export async function connectStripeAction(
  input: ConnectStripeActionInput,
): Promise<ConnectStripeFailure> {
  const parsed = parseInput(connectStripeActionSchema, input);
  if (!parsed.ok) return parsed;
  const { country, acceptCreatorTerms } = parsed.data;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    async (target) => {
      try {
        return await getPaymentsService().connectStripe(target.actor, target.communityId, {
          ...(country ? { country } : {}),
          acceptCreatorTerms,
        });
      } catch (error) {
        if (error instanceof CreatorTermsRequiredError) return null;
        throw error;
      }
    },
  );
  if (!result.ok) return result;
  if (!result.data) {
    return {
      ok: false,
      creatorTermsRequired: true,
      message: "Accept the updated Creator Terms before you continue with Stripe.",
    };
  }
  redirect(externalUrl(result.data.url));
}

export async function connectOwnKeysAction(input: OwnKeysActionInput): Promise<ActionResult<null>> {
  const parsed = parseInput(ownKeysActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, secretKey, webhookSecret } = parsed.data;
  const result = await attempt("creator", slug, managePaymentsPath(slug), (target) =>
    getPaymentsService().connectOwnKeys(target.actor, target.communityId, {
      secretKey,
      webhookSecret,
    }),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  return { ok: true, data: null };
}

export async function connectProviderAction(
  input: ConnectProviderActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(connectProviderActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, ...credentials } = parsed.data;
  const result = await attempt("creator", slug, managePaymentsPath(slug), (target) =>
    getPaymentsService().connectProvider(target.actor, target.communityId, credentials),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  return { ok: true, data: null };
}

export async function saveProviderWebhookSecretAction(
  input: ProviderSecretActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(providerSecretActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, webhookSecret } = parsed.data;
  const result = await attempt("creator", slug, managePaymentsPath(slug), (target) =>
    getPaymentsService().saveProviderWebhookSecret(target.actor, target.communityId, {
      webhookSecret,
    }),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  return { ok: true, data: null };
}

export async function sendTestWebhookAction(
  input: SlugActionInput,
): Promise<ActionResult<{ delivered: boolean }>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().sendTestWebhook(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  if (!result.data.delivered) {
    return failure(
      result.data.status === null
        ? "The test event couldn't reach this site. Check that APP_URL is the public address of this server."
        : "The test event reached this site but was refused. Paste the signing secret again.",
    );
  }
  return { ok: true, data: { delivered: true } };
}

export async function disconnectStripeAction(
  input: DisconnectActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(disconnectActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, exit, ...choice } = parsed.data;
  const result = await attempt("creator", slug, managePaymentsPath(slug), async (target) => {
    await getPaymentsService().disconnectStripe(target.actor, target.communityId, choice);
    await recordExitQuietly(
      target.actor,
      { communityId: target.communityId, action: "disconnect_stripe" },
      exit,
    );
  });
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}

export async function acceptCreatorTermsAction(
  input: SlugActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().acceptCreatorTerms(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  return { ok: true, data: null };
}

export async function forceDisconnectAction(input: SlugActionInput): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().forceDisconnect(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}

export async function keepPaymentAccountAction(
  input: SlugActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().keepPaymentAccount(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}

export async function retryPaidMembersChangeAction(
  input: SlugActionInput,
): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().retryExitRun(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}

export async function refreshConnectionAction(input: SlugActionInput): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().refreshConnection(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(managePaymentsPath(result.slug));
  return { ok: true, data: null };
}

export async function savePlanAction(input: SavePlanActionInput): Promise<ActionResult<PlanView>> {
  const parsed = parseInput(savePlanActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, ...plan } = parsed.data;
  const result = await attempt("creator", slug, managePaymentsPath(slug), (target) =>
    getPaymentsService().upsertPlan(target.actor, target.communityId, plan),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: result.data };
}

export async function archivePlanAction(input: SlugActionInput): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const result = await attempt(
    "creator",
    parsed.data.slug,
    managePaymentsPath(parsed.data.slug),
    (target) => getPaymentsService().archivePlan(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}

export async function cancelMembershipAction(input: CancelMembershipActionInput): Promise<Failure> {
  const parsed = parseInput(cancelMembershipActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, feedback, comment } = parsed.data;
  const result = await attempt("member", slug, `${membershipHref(slug)}/cancel`, (target) =>
    getPaymentsService().cancelMembership(target.actor, target.communityId, { feedback, comment }),
  );
  if (!result.ok) return result;
  redirect(externalUrl(result.data.url));
}

export async function switchToYearlyAction(input: SlugActionInput): Promise<Failure> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug } = parsed.data;
  const result = await attempt("member", slug, membershipHref(slug), (target) =>
    getPaymentsService().switchToYearly(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  redirect(externalUrl(result.data.url));
}

export async function pauseMembershipAction(input: PauseMembershipActionInput): Promise<Failure> {
  const parsed = parseInput(pauseMembershipActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug, months } = parsed.data;
  const result = await attempt("member", slug, `${membershipHref(slug)}/cancel`, (target) =>
    getPaymentsService().pauseMembership(target.actor, target.communityId, { months }),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  redirect(
    `${membershipHref(result.slug)}?paused=${result.data.resumesAt.toISOString().slice(0, 10)}`,
  );
}

export async function resumeMembershipAction(input: SlugActionInput): Promise<ActionResult<null>> {
  const parsed = parseInput(slugActionSchema, input);
  if (!parsed.ok) return parsed;
  const { slug } = parsed.data;
  const result = await attempt("member", slug, membershipHref(slug), (target) =>
    getPaymentsService().resumeMembership(target.actor, target.communityId),
  );
  if (!result.ok) return result;
  revalidatePath(`/c/${result.slug}`, "layout");
  return { ok: true, data: null };
}
