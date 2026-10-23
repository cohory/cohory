"use server";

import { ApprovalsError, getApprovalsService } from "@cohory/agents/approvals";
import { getApprovalGateway } from "@cohory/api";
import { signInPath } from "@cohory/auth";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveCommunity } from "../posts/context";
import { failure } from "../posts/errors";
import { currentSession } from "../session";
import { manageActionFailure } from "./errors";
import { getAppAuth } from "../auth/instance";

export type ApprovalActionResult<T> =
  { ok: true; data: T } | { ok: false; message: string; reauth?: boolean };

const slug = z.string().min(1).max(64);
const decisionSchema = z.object({ slug, approvalId: z.uuid() });
const rejectSchema = decisionSchema.extend({ note: z.string().max(500) });

const approvalMessages: Record<ApprovalsError["code"], string> = {
  not_found: "We could not find that request. Refresh the page.",
  limit_reached: "This agent has too many requests waiting.",
  expired: "This request expired after 72 hours. The agent can ask again.",
  reauth_required:
    "For your safety, sign in again before you approve. Approvals need a sign in from the last 10 minutes.",
  agent_inactive: "The agent was paused or revoked, so this request was rejected.",
  download_unavailable: "This download is no longer available.",
};

function approvalFailure(error: unknown): ApprovalActionResult<never> | null {
  if (error instanceof ApprovalsError) {
    return {
      ok: false,
      message: approvalMessages[error.code],
      ...(error.code === "reauth_required" ? { reauth: true } : {}),
    };
  }
  return manageActionFailure(error);
}

async function guard<T>(
  path: (slug: string) => string,
  rawSlug: string,
  fn: (context: Awaited<ReturnType<typeof resolveCommunity>>) => Promise<T>,
): Promise<ApprovalActionResult<T>> {
  try {
    const context = await resolveCommunity(rawSlug);
    const data = await fn(context);
    revalidatePath(path(context.slug));
    return { ok: true, data };
  } catch (error: unknown) {
    const result = approvalFailure(error);
    if (result) return result;
    throw error;
  }
}

const queuePath = (current: string) => `/c/${current}/manage/inbox`;

export interface ApproveResult {
  readonly state: string;
  readonly revealed: Readonly<Record<string, string>> | null;
}

export async function approveRequestAction(
  raw: z.input<typeof decisionSchema>,
): Promise<ApprovalActionResult<ApproveResult>> {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return failure("Check the request and try again.");
  const session = await currentSession();
  const signedInAt = session ? new Date(session.session.createdAt) : null;
  return guard(queuePath, parsed.data.slug, async ({ access, communityId }) => {
    const decision = await getApprovalGateway().approve(
      access.actor,
      communityId,
      parsed.data.approvalId,
      signedInAt,
    );
    return { state: decision.view.state, revealed: decision.revealed };
  });
}

export async function rejectRequestAction(
  raw: z.input<typeof rejectSchema>,
): Promise<ApprovalActionResult<null>> {
  const parsed = rejectSchema.safeParse(raw);
  if (!parsed.success) return failure("Keep the note under 500 characters.");
  return guard(queuePath, parsed.data.slug, async ({ access, communityId }) => {
    await getApprovalsService().reject(
      access.actor,
      communityId,
      parsed.data.approvalId,
      parsed.data.note || null,
    );
    return null;
  });
}

export async function signInAgainAction(rawSlug: string): Promise<void> {
  const parsed = slug.safeParse(rawSlug);
  await getAppAuth().api.signOut({ headers: await headers() });
  redirect(signInPath(parsed.success ? `${queuePath(parsed.data)}?tab=approvals` : undefined));
}
