"use server";

import { AgentsError } from "@cohory/agents";
import { ConsentError, getOAuthService } from "@cohory/agents/oauth";
import { ForbiddenError, scopeSchema, UnauthenticatedError } from "@cohory/authz";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../actor";
import { failure, type ActionResult } from "../posts/errors";
import { currentSession } from "../session";

const requestParams = z.record(z.string().max(64), z.string().max(2000));

const approveSchema = z.object({
  params: requestParams,
  communityId: z.uuid({ error: "Choose a community." }),
  agent: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), name: z.string() }),
    z.object({ kind: z.literal("existing"), agentId: z.uuid({ error: "Choose an agent." }) }),
  ]),
  scopes: z.array(scopeSchema).max(32),
});

const consentMessages = {
  not_allowed:
    "Only owners and admins can connect apps. Choose another community, or create an agent by hand in Account, Agents.",
  agent_not_found: "That agent no longer exists. Choose another one or create a new agent.",
  agent_not_active: "That agent is paused or revoked. Choose another one or create a new agent.",
  no_scopes: "Choose at least one permission this agent already has.",
  invalid_name: "Give the agent a name of 60 characters or fewer.",
} as const;

function consentFailure(error: unknown): { ok: false; message: string } | null {
  if (error instanceof ConsentError) {
    return failure(consentMessages[error.code]);
  }
  if (error instanceof UnauthenticatedError) {
    return failure("Your session ended. Sign in again, then start the connection from the app.");
  }
  if (error instanceof ForbiddenError) {
    return failure("You cannot do this with your current role.");
  }
  if (error instanceof AgentsError) {
    return failure("That connection no longer exists. Refresh the page.");
  }
  return null;
}

export async function approveConnectionAction(
  raw: z.input<typeof approveSchema>,
): Promise<ActionResult<{ url: string }>> {
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check what you chose and try again.");
  }
  const actor = actorFor(await currentSession());
  try {
    const result = await getOAuthService().approve(actor, {
      request: parsed.data.params,
      communityId: parsed.data.communityId,
      agent: parsed.data.agent,
      scopes: parsed.data.scopes,
    });
    return result.kind === "redirect"
      ? { ok: true, data: { url: result.url } }
      : failure(result.message);
  } catch (error: unknown) {
    const handled = consentFailure(error);
    if (handled) return handled;
    throw error;
  }
}

export async function cancelConnectionAction(
  params: Record<string, string>,
): Promise<ActionResult<{ url: string }>> {
  const parsed = requestParams.safeParse(params);
  if (!parsed.success) {
    return failure("This sign in link is malformed. Start again from the app.");
  }
  const actor = actorFor(await currentSession());
  try {
    const result = await getOAuthService().deny(actor, parsed.data);
    return result.kind === "redirect"
      ? { ok: true, data: { url: result.url } }
      : failure(result.message);
  } catch (error: unknown) {
    const handled = consentFailure(error);
    if (handled) return handled;
    throw error;
  }
}

export async function disconnectAppAction(input: {
  grantId: string;
  communityId?: string;
  path: string;
}): Promise<ActionResult<null>> {
  const parsed = z
    .object({
      grantId: z.uuid(),
      communityId: z.uuid().optional(),
      path: z
        .string()
        .regex(
          /^\/(account\/(connected-apps|agents)|c\/[a-z0-9-]{1,64}\/manage\/settings\/agents)$/,
        ),
    })
    .safeParse(input);
  if (!parsed.success) {
    return failure("That connection no longer exists. Refresh the page.");
  }
  const actor = actorFor(await currentSession());
  try {
    await getOAuthService().disconnect(actor, parsed.data.grantId, parsed.data.communityId);
    revalidatePath(parsed.data.path);
    return { ok: true, data: null };
  } catch (error: unknown) {
    const handled = consentFailure(error);
    if (handled) return handled;
    throw error;
  }
}
