"use server";

import { creatorMoments } from "@cohory/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../actor";
import { resolveCommunity } from "../posts/context";
import { actionFailure, failure, type ActionResult } from "../posts/errors";
import { requireCurrentSession } from "../session";
import { getCreatorFeedbackService } from "./service";

const respondSchema = z.object({
  slug: z.string().min(1).max(64),
  moment: z.enum(creatorMoments),
  outcome: z.enum(["answered", "dismissed", "snoozed"]),
  score: z.number().int().min(1).max(5).nullable().default(null),
  comment: z.string().max(1000).default(""),
  optOut: z.boolean().default(false),
});

export type MomentResponseActionInput = z.input<typeof respondSchema>;

const tryAgain = "We could not save that. Try again.";

export async function respondToMomentAction(
  raw: MomentResponseActionInput,
): Promise<ActionResult<null>> {
  try {
    const { slug, ...input } = respondSchema.parse(raw);
    const context = await resolveCommunity(slug);
    await getCreatorFeedbackService().respond(context.access.actor, {
      ...input,
      communityId: context.communityId,
    });
    return { ok: true, data: null };
  } catch (error: unknown) {
    return actionFailure(error, "creator") ?? failure(tryAgain);
  }
}

export async function setMomentQuestionsAction(ask: boolean): Promise<ActionResult<null>> {
  const session = await requireCurrentSession("/account/notifications");
  try {
    await getCreatorFeedbackService().setOptOut(actorFor(session), !z.boolean().parse(ask));
  } catch (error: unknown) {
    return actionFailure(error, "creator") ?? failure(tryAgain);
  }
  revalidatePath("/account/notifications");
  return { ok: true, data: null };
}
