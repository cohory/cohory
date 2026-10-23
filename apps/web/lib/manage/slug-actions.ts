"use server";

import { getManageService } from "@cohory/communities";
import { revalidatePath } from "next/cache";

import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "./errors";
import { changeSlugSchema, type ChangeSlugActionInput } from "./schemas";

export async function changeSlugAction(
  raw: ChangeSlugActionInput,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = changeSlugSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Check the community URL and try again.");
  }
  try {
    const context = await resolveCommunity(parsed.data.slug);
    const status = await getManageService().changeSlug(context.access.actor, context.communityId, {
      slug: parsed.data.newSlug,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    revalidatePath(`/c/${status.slug}`, "layout");
    return { ok: true, data: { slug: status.slug } };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}
