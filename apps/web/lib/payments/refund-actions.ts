"use server";

import { getManageService } from "@cohory/communities";
import { refundPolicyMaxLength } from "@cohory/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { manageActionFailure } from "../manage/errors";
import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";

const refundPolicySchema = z.object({
  slug: z.string().min(1).max(64),
  refundPolicy: z
    .string()
    .trim()
    .max(refundPolicyMaxLength, `Keep the refund rule under ${refundPolicyMaxLength} characters.`),
});

export async function saveRefundPolicyAction(raw: {
  slug: string;
  refundPolicy: string;
}): Promise<ActionResult<null>> {
  const parsed = refundPolicySchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the refund rule and try again.");
  }
  try {
    const context = await resolveCommunity(parsed.data.slug);
    await getManageService().updateSettings(context.access.actor, context.communityId, {
      refundPolicy: parsed.data.refundPolicy === "" ? null : parsed.data.refundPolicy,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}
