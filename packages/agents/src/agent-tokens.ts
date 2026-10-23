import { assertCan, type Actor, ForbiddenError } from "@cohory/authz";
import { apiTokens } from "@cohory/db/schema";
import { eq, isNull } from "drizzle-orm";

import { AgentsError } from "./errors";
import { agentManageContext } from "./manage-context";
import { issueAgentTokenInputSchema, parseInput, type IssueAgentTokenInput } from "./schemas";
import { knownScopes, type CreatedToken } from "./views";
import {
  uuidPattern,
  requireUser,
  lifetimeDays,
  assertRegenerable,
  type AgentsContext,
} from "./service-context";

export function createAgentTokenMethods(ctx: AgentsContext) {
  const { now, roleIn, scoped, loadAgent, insertToken, audit } = ctx;

  return {
    async issueAgentToken(
      actor: Actor,
      communityId: string,
      agentId: string,
      input: IssueAgentTokenInput,
    ): Promise<CreatedToken> {
      const { userId } = requireUser(actor);
      const parsed = parseInput(issueAgentTokenInputSchema, input);
      const role = await roleIn(communityId, userId);
      return scoped(communityId, async (queries) => {
        const agent = await loadAgent(queries, agentId);
        assertCan(actor, "manage", "agent", agentManageContext(role, agent, userId));
        if (agent.ownerId !== userId) {
          throw new ForbiddenError("issue_token", "agent");
        }
        if (agent.status !== "active") {
          throw new AgentsError("agent_not_active");
        }
        const created = await insertToken(queries, {
          kind: "agent",
          userId: agent.ownerId,
          agentId: agent.id,
          name: parsed.name,
          scopes: knownScopes(agent.scopes),
          expiresInDays: parsed.expiresInDays,
          createdBy: userId,
        });
        await audit(queries, userId, "agent.token_created", agent.id, {
          tokenId: created.view.id,
          name: parsed.name,
          expiresAt: created.view.expiresAt.toISOString(),
        });
        return created;
      });
    },

    async regenerateAgentToken(
      actor: Actor,
      communityId: string,
      agentId: string,
      tokenId: string,
    ): Promise<CreatedToken> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      return scoped(communityId, async (queries) => {
        const agent = await loadAgent(queries, agentId);
        assertCan(actor, "manage", "agent", agentManageContext(role, agent, userId));
        if (agent.ownerId !== userId) {
          throw new ForbiddenError("issue_token", "agent");
        }
        if (agent.status !== "active") {
          throw new AgentsError("agent_not_active");
        }
        const [token] = uuidPattern.test(tokenId)
          ? await queries.tx
              .select()
              .from(apiTokens)
              .where(
                queries.where(
                  apiTokens,
                  eq(apiTokens.id, tokenId),
                  eq(apiTokens.agentId, agent.id),
                  isNull(apiTokens.oauthGrantId),
                ),
              )
              .for("update")
              .limit(1)
          : [];
        if (!token) {
          throw new AgentsError("not_found");
        }
        assertRegenerable(token);
        await queries.tx
          .update(apiTokens)
          .set({ revokedAt: now(), revokedBy: userId })
          .where(queries.where(apiTokens, eq(apiTokens.id, token.id)));
        const created = await insertToken(queries, {
          kind: "agent",
          userId: agent.ownerId,
          agentId: agent.id,
          name: token.name,
          scopes: knownScopes(agent.scopes),
          expiresInDays: lifetimeDays(token),
          createdBy: userId,
        });
        await audit(queries, userId, "agent.token_regenerated", agent.id, {
          tokenId: created.view.id,
          replaces: token.id,
          name: token.name,
          expiresAt: created.view.expiresAt.toISOString(),
        });
        return created;
      });
    },

    async revokeAgentToken(
      actor: Actor,
      communityId: string,
      agentId: string,
      tokenId: string,
    ): Promise<void> {
      const { userId } = requireUser(actor);
      const role = await roleIn(communityId, userId);
      await scoped(communityId, async (queries) => {
        const agent = await loadAgent(queries, agentId);
        assertCan(actor, "manage", "agent", agentManageContext(role, agent, userId));
        const revoked = uuidPattern.test(tokenId)
          ? await queries.tx
              .update(apiTokens)
              .set({ revokedAt: now(), revokedBy: userId })
              .where(
                queries.where(
                  apiTokens,
                  eq(apiTokens.id, tokenId),
                  eq(apiTokens.agentId, agent.id),
                  isNull(apiTokens.revokedAt),
                ),
              )
              .returning({ id: apiTokens.id })
          : [];
        if (revoked.length === 0) {
          throw new AgentsError("not_found");
        }
        await audit(queries, userId, "agent.token_revoked", agent.id, { tokenId });
      });
    },
  };
}
