import { assertCan, type Actor } from "@cohory/authz";
import { setRlsValue } from "@cohory/db";
import { apiTokens, communities, memberships } from "@cohory/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

import { personalTokenEnded } from "./authenticate";
import { AgentsError } from "./errors";
import {
  createPersonalTokenInputSchema,
  parseInput,
  type CreatePersonalTokenInput,
} from "./schemas";
import { toTokenView, type CreatedToken, type PersonalTokenView } from "./views";
import {
  uuidPattern,
  requireUser,
  assertAvailable,
  lifetimeDays,
  assertRegenerable,
  type AgentsContext,
} from "./service-context";

export function createPersonalTokenMethods(ctx: AgentsContext) {
  const { deps, now, roleIn, scoped, insertToken, audit } = ctx;

  return {
    async listPersonalTokens(actor: Actor): Promise<PersonalTokenView[]> {
      const { userId } = requireUser(actor);
      return deps.db.transaction(async (tx) => {
        await setRlsValue(tx, "api_token_owner", userId);
        await setRlsValue(tx, "user_id", userId);
        const rows = await tx
          .select({
            token: apiTokens,
            slug: communities.slug,
            name: communities.name,
            membership: { status: memberships.status, joinedAt: memberships.joinedAt },
          })
          .from(apiTokens)
          .innerJoin(communities, eq(communities.id, apiTokens.communityId))
          .leftJoin(
            memberships,
            and(
              eq(memberships.communityId, apiTokens.communityId),
              eq(memberships.userId, apiTokens.userId),
            ),
          )
          .where(
            and(
              eq(apiTokens.userId, userId),
              eq(apiTokens.kind, "personal"),
              isNull(communities.deletedAt),
            ),
          )
          .orderBy(desc(apiTokens.createdAt));
        const at = now();
        return rows.map((row) => {
          const view = toTokenView(row.token, at);
          const ended =
            view.state === "active" && personalTokenEnded(row.token, row.membership ?? undefined);
          return {
            ...view,
            ...(ended ? { state: "revoked" as const } : {}),
            community: { slug: row.slug, name: row.name },
          };
        });
      });
    },

    async createPersonalToken(
      actor: Actor,
      input: CreatePersonalTokenInput,
    ): Promise<CreatedToken<PersonalTokenView>> {
      const { userId } = requireUser(actor);
      const parsed = parseInput(createPersonalTokenInputSchema, input);
      const role = await roleIn(parsed.communityId, userId);
      assertCan(actor, "create_own", "api_token", { role });
      assertAvailable(role, "token", parsed.scopes);
      const [community] = await deps.db
        .select({ slug: communities.slug, name: communities.name })
        .from(communities)
        .where(and(eq(communities.id, parsed.communityId), isNull(communities.deletedAt)))
        .limit(1);
      if (!community) {
        throw new AgentsError("not_found");
      }
      return scoped(parsed.communityId, async (queries) => {
        const created = await insertToken(queries, {
          kind: "personal",
          userId,
          agentId: null,
          name: parsed.name,
          scopes: parsed.scopes,
          expiresInDays: parsed.expiresInDays,
          createdBy: userId,
        });
        await audit(queries, userId, "api_token.created", created.view.id, {
          name: parsed.name,
          scopes: parsed.scopes,
          expiresAt: created.view.expiresAt.toISOString(),
        });
        return { token: created.token, view: { ...created.view, community } };
      });
    },

    async revokePersonalToken(actor: Actor, tokenId: string): Promise<void> {
      const { userId } = requireUser(actor);
      const token = await deps.db.transaction(async (tx) => {
        await setRlsValue(tx, "api_token_owner", userId);
        const [row] = uuidPattern.test(tokenId)
          ? await tx
              .select({ id: apiTokens.id, communityId: apiTokens.communityId })
              .from(apiTokens)
              .where(
                and(
                  eq(apiTokens.id, tokenId),
                  eq(apiTokens.userId, userId),
                  eq(apiTokens.kind, "personal"),
                ),
              )
              .limit(1)
          : [];
        return row ?? null;
      });
      if (!token) {
        throw new AgentsError("not_found");
      }
      await scoped(token.communityId, async (queries) => {
        const revoked = await queries.tx
          .update(apiTokens)
          .set({ revokedAt: now(), revokedBy: userId })
          .where(queries.where(apiTokens, eq(apiTokens.id, token.id), isNull(apiTokens.revokedAt)))
          .returning({ id: apiTokens.id });
        if (revoked.length > 0) {
          await audit(queries, userId, "api_token.revoked", token.id, {});
        }
      });
    },

    async regeneratePersonalToken(
      actor: Actor,
      tokenId: string,
    ): Promise<CreatedToken<PersonalTokenView>> {
      const { userId } = requireUser(actor);
      const found = await deps.db.transaction(async (tx) => {
        await setRlsValue(tx, "api_token_owner", userId);
        const [row] = uuidPattern.test(tokenId)
          ? await tx
              .select({
                communityId: apiTokens.communityId,
                slug: communities.slug,
                name: communities.name,
              })
              .from(apiTokens)
              .innerJoin(communities, eq(communities.id, apiTokens.communityId))
              .where(
                and(
                  eq(apiTokens.id, tokenId),
                  eq(apiTokens.userId, userId),
                  eq(apiTokens.kind, "personal"),
                  isNull(communities.deletedAt),
                ),
              )
              .limit(1)
          : [];
        return row ?? null;
      });
      if (!found) {
        throw new AgentsError("not_found");
      }
      const role = await roleIn(found.communityId, userId);
      assertCan(actor, "create_own", "api_token", { role });
      return scoped(found.communityId, async (queries) => {
        const [token] = await queries.tx
          .select()
          .from(apiTokens)
          .where(queries.where(apiTokens, eq(apiTokens.id, tokenId)))
          .for("update")
          .limit(1);
        if (!token) {
          throw new AgentsError("not_found");
        }
        assertRegenerable(token);
        await queries.tx
          .update(apiTokens)
          .set({ revokedAt: now(), revokedBy: userId })
          .where(queries.where(apiTokens, eq(apiTokens.id, token.id)));
        const created = await insertToken(queries, {
          kind: "personal",
          userId,
          agentId: null,
          name: token.name,
          scopes: token.scopes,
          expiresInDays: lifetimeDays(token),
          createdBy: userId,
        });
        await audit(queries, userId, "api_token.regenerated", created.view.id, {
          replaces: token.id,
          name: token.name,
          expiresAt: created.view.expiresAt.toISOString(),
        });
        return {
          token: created.token,
          view: { ...created.view, community: { slug: found.slug, name: found.name } },
        };
      });
    },
  };
}
