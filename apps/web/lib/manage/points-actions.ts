"use server";

import { getGamificationService, GamificationValidationError } from "@cohory/gamification";
import { revalidatePath } from "next/cache";

import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "./errors";
import { confirmNameSchema, memberActionSchema, type ConfirmNameInput } from "./schemas";

export async function resetPointsAction(
  raw: ConfirmNameInput,
): Promise<ActionResult<{ members: number }>> {
  const parsed = confirmNameSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  try {
    const context = await resolveCommunity(parsed.data.slug);
    const result = await getGamificationService().resetPoints(
      context.access.actor,
      context.communityId,
      { confirmation: parsed.data.confirmName },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: { members: result.members } };
  } catch (error) {
    if (error instanceof GamificationValidationError) {
      return failure(error.issues[0]?.message ?? "Type the community name to confirm.");
    }
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}

export async function resetMemberPointsAction(raw: {
  readonly slug: string;
  readonly userId: string;
}): Promise<ActionResult<null>> {
  const parsed = memberActionSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  try {
    const context = await resolveCommunity(parsed.data.slug);
    await getGamificationService().resetMemberPoints(
      context.access.actor,
      context.communityId,
      parsed.data.userId,
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}
