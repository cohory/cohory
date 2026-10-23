"use server";

import { getManageService, type BulkResult } from "@cohory/communities";
import { revalidatePath } from "next/cache";

import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "./errors";
import {
  accessSettingsSchema,
  decideJoinRequestSchema,
  decideJoinRequestsSchema,
  type AccessSettingsInput,
  type DecideJoinRequestActionInput,
  type DecideJoinRequestsActionInput,
} from "./schemas";

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}

export async function saveAccessAction(raw: AccessSettingsInput): Promise<ActionResult<null>> {
  const parsed = accessSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the join settings and try again.");
  }
  return guard(async () => {
    const input = parsed.data;
    const context = await resolveCommunity(input.slug);
    await getManageService().updateSettings(context.access.actor, context.communityId, {
      joinMode: input.joinMode,
      joinQuestions: input.joinQuestions,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function decideJoinRequestAction(
  raw: DecideJoinRequestActionInput,
): Promise<ActionResult<null>> {
  const parsed = decideJoinRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the note and try again.");
  }
  return guard(async () => {
    const input = parsed.data;
    const context = await resolveCommunity(input.slug);
    const service = getManageService();
    const decide =
      input.decision === "approve" ? service.approveJoinRequest : service.declineJoinRequest;
    await decide(context.access.actor, context.communityId, input.requestId, {
      note: input.note || null,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function decideJoinRequestsAction(
  raw: DecideJoinRequestsActionInput,
): Promise<ActionResult<BulkResult>> {
  const parsed = decideJoinRequestsSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("Select at most 100 requests and try again.");
  }
  return guard(async () => {
    const input = parsed.data;
    const context = await resolveCommunity(input.slug);
    const result = await getManageService().decideJoinRequests(
      context.access.actor,
      context.communityId,
      { requestIds: input.requestIds, decision: input.decision },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return result;
  });
}
