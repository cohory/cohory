"use server";

import { getCommunitiesService } from "@cohory/communities";
import { compNoteMaxLength } from "@cohory/db/schema";
import { getEmailOutbox } from "@cohory/email";
import { getPaymentsService, type CompInvitationView } from "@cohory/payments";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

import { actorFor } from "../actor";
import { communityOptOutLinks } from "../email/opt-out";
import { appUrl } from "../manage/views";
import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { paymentsActionFailure } from "./errors";
import { requireCurrentSession } from "../session";
import { communityEmailBrandFor } from "../theme/email-brand";
import { membershipHref } from "./views";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const grantSchema = z.object({
  slug,
  email: z.email({ error: "Enter the person's email address." }).max(254),
  until: z.union([z.literal(""), z.iso.date({ error: "Choose a valid end date." })]),
  note: z
    .string()
    .trim()
    .max(compNoteMaxLength, { error: `Keep the note under ${compNoteMaxLength} characters.` }),
});

const revokeSchema = z.object({ slug, compId: z.uuid() });
const withdrawSchema = z.object({ slug, invitationId: z.uuid() });
const acceptSchema = z.object({ slug, invitationId: z.uuid() });

export type GrantCompActionInput = z.input<typeof grantSchema>;
export type RevokeCompActionInput = z.input<typeof revokeSchema>;
export type WithdrawCompInvitationActionInput = z.input<typeof withdrawSchema>;
export type AcceptCompInvitationActionInput = z.input<typeof acceptSchema>;
export type GrantCompOutcome = "granted" | "invited";

const dayMs = 24 * 60 * 60 * 1000;

function endOfDay(day: string): Date {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + dayMs - 1);
}

async function run<T>(
  slugValue: string,
  fn: (context: Awaited<ReturnType<typeof resolveCommunity>>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await resolveCommunity(slugValue);
    const data = await fn(context);
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    const result = paymentsActionFailure(error, "creator");
    if (result) return result;
    throw error;
  }
}

async function sendCompInvitation(
  invitation: CompInvitationView,
  community: { readonly id: string; readonly slug: string; readonly name: string },
): Promise<void> {
  try {
    const optOut = communityOptOutLinks(invitation.email, community.id);
    await getEmailOutbox().send({
      template: "comp-invitation",
      to: invitation.email,
      communityId: community.id,
      headers: optOut.headers,
      data: {
        communityName: community.name,
        communityBrand: await communityEmailBrandFor(community.id),
        email: invitation.email,
        url: `${appUrl()}${membershipHref(community.slug)}`,
        expiresAt: invitation.expiresAt?.toISOString() ?? null,
        optOutUrl: optOut.url,
      },
    });
  } catch (error) {
    logger.error(
      {
        reason: error instanceof Error ? error.name : "unknown",
      },
      "Could not queue a free access invitation",
    );
  }
}

export async function grantCompAction(
  raw: GrantCompActionInput,
): Promise<ActionResult<GrantCompOutcome>> {
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  }
  const input = parsed.data;
  return run(input.slug, async (context) => {
    const result = await getPaymentsService().grantComp(context.access.actor, context.communityId, {
      email: input.email,
      expiresAt: input.until ? endOfDay(input.until) : null,
      ...(input.note ? { note: input.note } : {}),
    });
    if (result.kind === "invited") {
      const community = await getCommunitiesService().getCommunityBySlug(
        context.access.actor,
        context.slug,
      );
      await sendCompInvitation(result.invitation, community);
    }
    return result.kind;
  });
}

export async function withdrawCompInvitationAction(
  raw: WithdrawCompInvitationActionInput,
): Promise<ActionResult<null>> {
  const parsed = withdrawSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  return run(parsed.data.slug, async (context) => {
    await getPaymentsService().withdrawCompInvitation(
      context.access.actor,
      context.communityId,
      parsed.data.invitationId,
    );
    return null;
  });
}

export async function acceptCompInvitationAction(
  raw: AcceptCompInvitationActionInput,
): Promise<ActionResult<null>> {
  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  const { slug: slugValue, invitationId } = parsed.data;
  const actor = actorFor(await requireCurrentSession(membershipHref(slugValue)));
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slugValue);
    await getPaymentsService().acceptCompInvitation(actor, community.id, invitationId);
    revalidatePath(`/c/${community.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    const result = paymentsActionFailure(error, "member");
    if (result) return result;
    throw error;
  }
}

export async function revokeCompAction(raw: RevokeCompActionInput): Promise<ActionResult<null>> {
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  return run(parsed.data.slug, async (context) => {
    await getPaymentsService().revokeComp(
      context.access.actor,
      context.communityId,
      parsed.data.compId,
    );
    return null;
  });
}
