"use server";

import { getPostsService } from "@cohory/api/services";
import { getManageService } from "@cohory/communities";
import { revalidatePath } from "next/cache";

import { resolveCommunity } from "../posts/context";
import { actionFailure, failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "../manage/errors";
import {
  moderateReportSchema,
  reportContentSchema,
  type ModerateReportInput,
  type ReportContentInput,
} from "./schemas";

export async function reportContentAction(raw: ReportContentInput): Promise<ActionResult<null>> {
  const parsed = reportContentSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the report and try again.");
  }
  try {
    const { slug, type, id, reason, note } = parsed.data;
    const context = await resolveCommunity(slug);
    const service = getPostsService();
    const input = { reason, ...(note ? { note } : {}) };
    if (type === "post") {
      await service.reportPost(context.access.actor, context.communityId, id, input);
    } else {
      await service.reportComment(context.access.actor, context.communityId, id, input);
    }
    return { ok: true, data: null };
  } catch (error) {
    const result = actionFailure(error);
    if (result) return result;
    throw error;
  }
}

export async function moderateReportAction(raw: ModerateReportInput): Promise<ActionResult<null>> {
  const parsed = moderateReportSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Refresh the page and try again.");
  }
  try {
    const { slug, type, id, decision } = parsed.data;
    const context = await resolveCommunity(slug);
    const { actor } = context.access;
    const service = getPostsService();
    if (decision === "dismiss") {
      await service.dismissReports(actor, context.communityId, { type, id });
    } else if (decision === "ban") {
      await service.resolveReportsWithBan(actor, context.communityId, { type, id }, (authorId) =>
        getManageService()
          .banMember(actor, context.communityId, authorId)
          .then(() => undefined),
      );
    } else if (type === "post") {
      await service.deletePost(actor, context.communityId, id);
    } else {
      await service.deleteComment(actor, context.communityId, id);
    }
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}
