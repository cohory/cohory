"use server";

import { getManageService, setupMarks } from "@cohory/communities";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveCommunity } from "../../../lib/posts/context";
import type { ActionResult } from "../../../lib/posts/errors";
import { manageActionFailure } from "../../../lib/manage/errors";

const markSetupSchema = z.object({
  slug: z.string().min(1).max(64),
  mark: z.enum(setupMarks),
});

export async function markSetupAction(raw: {
  slug: string;
  mark: string;
}): Promise<ActionResult<null>> {
  try {
    const input = markSetupSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getManageService().markSetupProgress(
      context.access.actor,
      context.communityId,
      input.mark,
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error: unknown) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}
