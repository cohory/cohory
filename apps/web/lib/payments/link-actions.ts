"use server";

import { getCommunitiesService } from "@cohory/communities";
import { getEmailOutbox } from "@cohory/email";
import { getPaymentsService, linkBatchLimit } from "@cohory/payments";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

import { actorFor } from "../actor";
import { appUrl } from "../manage/views";
import { failure, type ActionResult } from "../posts/errors";
import { requireCurrentSession } from "../session";
import { communityEmailBrandFor } from "../theme/email-brand";
import { paymentsActionFailure } from "./errors";
import { subscribersHref, summarizeLinkResult, type LinkSummary } from "./linking";
import { membershipHref } from "./views";

const linkActionSchema = z.object({
  slug: z.string().min(1).max(64),
  addPlatformFee: z.boolean(),
  rows: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(255),
        action: z.enum(["link_member", "link_and_add", "invite", "skip"]),
        interval: z.enum(["month", "year"]).nullable(),
      }),
    )
    .min(1, "Choose at least one subscription.")
    .max(linkBatchLimit, `Link up to ${linkBatchLimit} subscriptions at a time.`),
});

export type LinkSubscriptionsActionInput = z.input<typeof linkActionSchema>;

async function sendInvites(
  emails: readonly string[],
  community: { id: string; name: string; slug: string },
): Promise<number> {
  if (emails.length === 0) {
    return 0;
  }
  const communityBrand = await communityEmailBrandFor(community.id);
  let sent = 0;
  for (const email of emails) {
    try {
      await getEmailOutbox().send({
        template: "subscription-moved",
        to: email,
        data: {
          communityName: community.name,
          communityBrand,
          email,
          url: `${appUrl()}${membershipHref(community.slug)}`,
        },
      });
      sent += 1;
    } catch (error) {
      logger.error(
        {
          reason: error instanceof Error ? error.name : "unknown",
        },
        "Could not queue a membership moved email",
      );
    }
  }
  return sent;
}

export async function linkSubscriptionsAction(
  raw: LinkSubscriptionsActionInput,
): Promise<ActionResult<LinkSummary>> {
  const parsed = linkActionSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check your choices and try again.");
  }
  const { slug, rows, addPlatformFee } = parsed.data;
  if (rows.some((row) => row.action !== "skip" && row.interval === null)) {
    return failure("Choose monthly or yearly for every subscription you link or invite.");
  }
  const actor = actorFor(await requireCurrentSession(subscribersHref(slug)));
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
    const result = await getPaymentsService().linkSubscriptions(actor, community.id, {
      rows: rows.map((row) => ({ ...row, interval: row.interval })),
      addPlatformFee,
    });
    const sent = await sendInvites(result.invitedEmails, community);
    revalidatePath(`/c/${community.slug}`, "layout");
    return { ok: true, data: summarizeLinkResult(result, sent) };
  } catch (error) {
    const handled = paymentsActionFailure(error, "creator");
    if (handled) return handled;
    throw error;
  }
}
