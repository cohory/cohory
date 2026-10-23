"use server";

import { getCommunitiesService } from "@cohory/communities";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveCommunity } from "../posts/context";
import { actionFailure, type ActionResult } from "../posts/errors";

const dismissWelcomeSchema = z.object({ slug: z.string().min(1).max(64) });

export async function dismissWelcomeAction(raw: { slug: string }): Promise<ActionResult<null>> {
  try {
    const input = dismissWelcomeSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getCommunitiesService().dismissOnboarding(context.access.actor, context.communityId);
    revalidatePath(`/c/${context.slug}`);
    return { ok: true, data: null };
  } catch (error: unknown) {
    const result = actionFailure(error);
    if (result) return result;
    throw error;
  }
}
