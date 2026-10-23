"use server";

import { getEntitlementsService } from "@cohory/api/services";
import { ApprovalsError } from "@cohory/agents/approvals";
import { getApprovalGateway } from "@cohory/api";
import {
  agentLicenseIds,
  delegationDenialMessages,
  DelegationRequiredError,
  EntitlementsError,
  entitlementsErrorDetails,
  EntitlementsValidationError,
} from "@cohory/entitlements";
import { getCommunitiesService } from "@cohory/communities";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../actor";
import { manageActionFailure } from "../manage/errors";
import { resolveCommunity, type CommunityContext } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { currentSession } from "../session";

const slug = z.string().min(1).max(64);
const invalid = failure("Check what you entered and try again.");

const purchaseMessages: Partial<Record<ApprovalsError["code"], string>> = {
  not_found: "We could not find that request. Refresh the page.",
  expired: "This request expired after 72 hours. Your agent can ask again.",
  agent_inactive: "The agent was paused or revoked, so this request was declined.",
};

function entitlementsFailure(error: unknown): { ok: false; message: string } | null {
  if (error instanceof EntitlementsValidationError) {
    return failure(error.issues[0]?.message ?? "Check what you entered and try again.");
  }
  if (error instanceof EntitlementsError) {
    return failure(entitlementsErrorDetails[error.code].message);
  }
  if (error instanceof DelegationRequiredError) {
    return failure(delegationDenialMessages[error.reason]);
  }
  if (error instanceof ApprovalsError) {
    return failure(purchaseMessages[error.code] ?? "This request can no longer be answered.");
  }
  return manageActionFailure(error);
}

async function inCommunity<T>(
  rawSlug: string,
  paths: (context: CommunityContext) => readonly string[],
  fn: (context: CommunityContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = slug.safeParse(rawSlug);
  if (!parsed.success) return invalid;
  try {
    const context = await resolveCommunity(parsed.data);
    const data = await fn(context);
    for (const path of paths(context)) {
      revalidatePath(path);
    }
    return { ok: true, data };
  } catch (error: unknown) {
    const result = entitlementsFailure(error);
    if (result) return result;
    throw error;
  }
}

function coursePaths(courseSlug: string) {
  return (context: CommunityContext) => [
    `/c/${context.slug}/classroom/${courseSlug}`,
    "/account/agents",
  ];
}

const settingsSchema = z.object({
  slug,
  courseSlug: z.string().min(1).max(200),
  courseId: z.uuid(),
  allowAgentAccess: z.boolean(),
  licenseId: z.enum(agentLicenseIds),
  licenseText: z.string().max(2000),
});

export async function saveAgentAccessAction(
  raw: z.input<typeof settingsSchema>,
): Promise<ActionResult<null>> {
  const input = settingsSchema.safeParse(raw);
  if (!input.success) return invalid;
  const { courseSlug, courseId, allowAgentAccess, licenseId, licenseText } = input.data;
  return inCommunity(input.data.slug, coursePaths(courseSlug), async ({ access, communityId }) => {
    await getEntitlementsService().updateCourseAgentSettings(access.actor, communityId, courseId, {
      allowAgentAccess,
      licenseId,
      licenseText: licenseText.trim() || null,
    });
    return null;
  });
}

const delegateSchema = z.object({
  slug,
  courseSlug: z.string().min(1).max(200),
  courseId: z.uuid(),
  agentId: z.uuid({ error: "Choose one of your agents." }),
});

export async function delegateCourseAction(
  raw: z.input<typeof delegateSchema>,
): Promise<ActionResult<null>> {
  const input = delegateSchema.safeParse(raw);
  if (!input.success) return failure(input.error.issues[0]?.message ?? "Choose an agent.");
  const { courseSlug, courseId, agentId } = input.data;
  return inCommunity(input.data.slug, coursePaths(courseSlug), async ({ access, communityId }) => {
    await getEntitlementsService().createDelegation(access.actor, communityId, {
      courseId,
      agentId,
    });
    return null;
  });
}

const delegationSchema = z.object({
  slug,
  courseSlug: z.string().max(200).optional(),
  delegationId: z.uuid(),
  action: z.enum(["renew", "revoke"]),
});

export async function changeDelegationAction(
  raw: z.input<typeof delegationSchema>,
): Promise<ActionResult<null>> {
  const input = delegationSchema.safeParse(raw);
  if (!input.success) return invalid;
  const { courseSlug, delegationId, action } = input.data;
  return inCommunity(
    input.data.slug,
    courseSlug ? coursePaths(courseSlug) : () => ["/account/agents"],
    async ({ access, communityId }) => {
      const service = getEntitlementsService();
      if (action === "renew") {
        await service.renewDelegation(access.actor, communityId, delegationId);
      } else {
        await service.revokeDelegation(access.actor, communityId, delegationId);
      }
      return null;
    },
  );
}

const purchaseSchema = z.object({
  slug,
  approvalId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function decidePurchaseAction(
  raw: z.input<typeof purchaseSchema>,
): Promise<ActionResult<{ checkoutUrl: string | null; state: string; errorCode: string | null }>> {
  const input = purchaseSchema.safeParse(raw);
  if (!input.success) return invalid;
  const { approvalId, decision } = input.data;
  try {
    const actor = actorFor(await currentSession());
    const community = await getCommunitiesService().getCommunityBySlug(actor, input.data.slug);
    const gateway = getApprovalGateway();
    let data: { checkoutUrl: string | null; state: string; errorCode: string | null };
    if (decision === "reject") {
      const view = await gateway.rejectPurchase(actor, community.id, approvalId);
      data = { checkoutUrl: null, state: view.state, errorCode: view.errorCode };
    } else {
      const result = await gateway.approvePurchase(actor, community.id, approvalId);
      data = {
        checkoutUrl: result.checkoutUrl,
        state: result.view.state,
        errorCode: result.view.errorCode,
      };
    }
    revalidatePath("/account/agents");
    return { ok: true, data };
  } catch (error: unknown) {
    const result = entitlementsFailure(error);
    if (result) return result;
    throw error;
  }
}
