"use server";

import { getPostsService } from "@cohory/api/services";
import {
  AgentsError,
  AgentsValidationError,
  getAgentsService,
  ScopeNotAvailableError,
  scopeNotAvailableMessage,
} from "@cohory/agents";
import { ApprovalRequiredError, scopeSchema } from "@cohory/authz";
import { getRateLimiter, RateLimitedError } from "@cohory/rate-limit";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../actor";
import { manageActionFailure } from "../manage/errors";
import { resolveCommunity, type CommunityContext } from "../posts/context";
import { failure, rateLimitMessage, type ActionResult } from "../posts/errors";
import { currentSession } from "../session";

const slug = z.string().min(1).max(64);
const scopesInput = z.array(scopeSchema).max(32);
const days = z.number().int().min(1).max(365);

export interface CreatedTokenResult {
  readonly token: string;
  readonly prefix: string;
  readonly slug: string;
}

function agentsFailure(error: unknown): { ok: false; message: string } | null {
  if (error instanceof ScopeNotAvailableError) {
    return failure(scopeNotAvailableMessage(error));
  }
  if (error instanceof RateLimitedError) {
    return failure(rateLimitMessage(error));
  }
  if (error instanceof AgentsValidationError) {
    return failure(error.issues[0]?.message ?? "Check what you entered and try again.");
  }
  if (error instanceof AgentsError) {
    return failure(
      error.code === "not_found"
        ? "That agent or token no longer exists. Refresh the page."
        : "This agent is paused or revoked. Resume it first.",
    );
  }
  if (error instanceof ApprovalRequiredError) {
    return failure("An agent cannot do this. Sign in as a person to do it.");
  }
  return manageActionFailure(error);
}

async function attempt<T>(fn: () => Promise<T>, path: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath(path);
    return { ok: true, data };
  } catch (error: unknown) {
    const result = agentsFailure(error);
    if (result) return result;
    throw error;
  }
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const invalid = failure("Check what you entered and try again.");

const personalTokenSchema = z.object({
  communityId: z.uuid({ error: "Choose a community." }),
  name: z.string(),
  scopes: scopesInput,
  expiresInDays: days,
});

export async function createPersonalTokenAction(
  raw: z.input<typeof personalTokenSchema>,
): Promise<ActionResult<CreatedTokenResult>> {
  const input = parse(personalTokenSchema, raw);
  if (!input) return invalid;
  const actor = actorFor(await currentSession());
  return attempt(async () => {
    const created = await getAgentsService().createPersonalToken(actor, input);
    return {
      token: created.token,
      prefix: created.view.prefix,
      slug: created.view.community.slug,
    };
  }, "/account/api-tokens");
}

export async function regeneratePersonalTokenAction(
  tokenId: string,
): Promise<ActionResult<CreatedTokenResult>> {
  const id = parse(z.uuid(), tokenId);
  if (!id) return invalid;
  const actor = actorFor(await currentSession());
  return attempt(async () => {
    if (actor.kind === "user") {
      getRateLimiter().consume("tokenRegenerate", actor.userId);
    }
    const created = await getAgentsService().regeneratePersonalToken(actor, id);
    return {
      token: created.token,
      prefix: created.view.prefix,
      slug: created.view.community.slug,
    };
  }, "/account/api-tokens");
}

export async function revokePersonalTokenAction(tokenId: string): Promise<ActionResult<null>> {
  const id = parse(z.uuid(), tokenId);
  if (!id) return invalid;
  const actor = actorFor(await currentSession());
  return attempt(async () => {
    await getAgentsService().revokePersonalToken(actor, id);
    return null;
  }, "/account/api-tokens");
}

async function inCommunity<T>(
  rawSlug: string,
  fn: (context: CommunityContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsedSlug = parse(slug, rawSlug);
  if (!parsedSlug) return invalid;
  try {
    const context = await resolveCommunity(parsedSlug);
    return attempt(() => fn(context), `/c/${context.slug}/manage/settings/agents`);
  } catch (error: unknown) {
    const result = agentsFailure(error);
    if (result) return result;
    throw error;
  }
}

const createAgentSchema = z.object({
  slug,
  name: z.string(),
  description: z.string(),
  scopes: scopesInput,
  communityWide: z.boolean(),
  tokenDays: days,
});

export async function createAgentAction(
  raw: z.input<typeof createAgentSchema>,
): Promise<ActionResult<CreatedTokenResult & { id: string }>> {
  const input = parse(createAgentSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId, slug: current }) => {
    const { agent, token } = await getAgentsService().createAgentWithToken(
      access.actor,
      communityId,
      {
        name: input.name,
        description: input.description,
        scopes: input.scopes,
        communityWide: input.communityWide,
        token: { name: "Main token", expiresInDays: input.tokenDays },
      },
    );
    return { id: agent.id, token: token.token, prefix: token.view.prefix, slug: current };
  });
}

const updateAgentSchema = z.object({
  slug,
  agentId: z.uuid(),
  scopes: scopesInput.optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export async function updateAgentAction(
  raw: z.input<typeof updateAgentSchema>,
): Promise<ActionResult<null>> {
  const input = parse(updateAgentSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId }) => {
    await getAgentsService().updateAgent(access.actor, communityId, input.agentId, {
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    return null;
  });
}

const agentRefSchema = z.object({ slug, agentId: z.uuid() });

export async function revokeAgentAction(
  raw: z.input<typeof agentRefSchema>,
): Promise<ActionResult<null>> {
  const input = parse(agentRefSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId }) => {
    await getAgentsService().revokeAgent(access.actor, communityId, input.agentId);
    return null;
  });
}

const issueSchema = z.object({ slug, agentId: z.uuid(), name: z.string(), expiresInDays: days });

export async function issueAgentTokenAction(
  raw: z.input<typeof issueSchema>,
): Promise<ActionResult<CreatedTokenResult>> {
  const input = parse(issueSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId, slug: current }) => {
    const created = await getAgentsService().issueAgentToken(
      access.actor,
      communityId,
      input.agentId,
      { name: input.name, expiresInDays: input.expiresInDays },
    );
    return { token: created.token, prefix: created.view.prefix, slug: current };
  });
}

const tokenRefSchema = z.object({ slug, agentId: z.uuid(), tokenId: z.uuid() });

export async function regenerateAgentTokenAction(
  raw: z.input<typeof tokenRefSchema>,
): Promise<ActionResult<CreatedTokenResult>> {
  const input = parse(tokenRefSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId, slug: current }) => {
    if (access.actor.kind === "user") {
      getRateLimiter().consume("tokenRegenerate", access.actor.userId);
    }
    const created = await getAgentsService().regenerateAgentToken(
      access.actor,
      communityId,
      input.agentId,
      input.tokenId,
    );
    return { token: created.token, prefix: created.view.prefix, slug: current };
  });
}

export async function revokeAgentTokenAction(
  raw: z.input<typeof tokenRefSchema>,
): Promise<ActionResult<null>> {
  const input = parse(tokenRefSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId }) => {
    await getAgentsService().revokeAgentToken(
      access.actor,
      communityId,
      input.agentId,
      input.tokenId,
    );
    return null;
  });
}

const draftSchema = z.object({ slug, draftId: z.uuid() });

export async function publishDraftAction(
  raw: z.input<typeof draftSchema>,
): Promise<ActionResult<null>> {
  const input = parse(draftSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId, slug: current }) => {
    await getPostsService().publishDraft(access.actor, communityId, input.draftId);
    revalidatePath(`/c/${current}`);
    return null;
  });
}

export async function discardDraftAction(
  raw: z.input<typeof draftSchema>,
): Promise<ActionResult<null>> {
  const input = parse(draftSchema, raw);
  if (!input) return invalid;
  return inCommunity(input.slug, async ({ access, communityId }) => {
    await getPostsService().discardDraft(access.actor, communityId, input.draftId);
    return null;
  });
}
