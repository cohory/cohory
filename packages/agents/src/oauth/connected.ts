import {
  assertCan,
  can,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type Scope,
} from "@cohory/authz";
import {
  appendAuditEntry,
  getMembership,
  parseCommunityId,
  runInCommunity,
  runWithAuditSource,
  setRlsValue,
  withCommunity,
  type ScopedQueries,
} from "@cohory/db";
import {
  agentIdentities,
  apiTokens,
  communities,
  oauthClients,
  oauthGrants,
  users,
} from "@cohory/db/schema";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { AgentsError } from "../errors";
import { agentManageContext } from "../manage-context";
import { knownScopes } from "../views";
import { endGrant, uuidPattern, type OAuthServiceDeps } from "./context";
import { redirectHost } from "./redirect-uri";

export interface ConnectedAppView {
  readonly grantId: string;
  readonly community: { readonly id: string; readonly slug: string; readonly name: string };
  readonly clientName: string;
  readonly clientUri: string | null;
  readonly redirectHost: string | null;
  readonly agent: { readonly id: string; readonly name: string };
  readonly owner: { readonly id: string; readonly name: string };
  readonly scopes: readonly Scope[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly canDisconnect: boolean;
}

function sessionUser(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  if (actor.credential) {
    throw new ForbiddenError("manage", "agent");
  }
  return actor.userId;
}

export function createConnectedApps(deps: OAuthServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function roleIn(communityId: string, userId: string): Promise<CommunityRole | null> {
    const membership = await getMembership(
      withCommunity(deps.db, parseCommunityId(communityId)),
      userId,
    );
    return membership?.status === "active" ? membership.role : null;
  }

  function scoped<T>(communityId: string, fn: (queries: ScopedQueries) => Promise<T>) {
    return runInCommunity(withCommunity(deps.db, parseCommunityId(communityId)), fn);
  }

  async function grantsIn(
    queries: ScopedQueries,
    community: { id: string; slug: string; name: string },
    filter: { userId?: string },
    decide: (grant: { userId: string; agentOwner: string; communityWide: boolean }) => boolean,
  ): Promise<ConnectedAppView[]> {
    const rows = await queries.tx
      .select({
        grant: oauthGrants,
        clientName: oauthClients.clientName,
        clientUri: oauthClients.clientUri,
        redirectUris: oauthClients.redirectUris,
        agentName: agentIdentities.name,
        agentOwner: agentIdentities.ownerId,
        communityWide: agentIdentities.communityWide,
        ownerName: users.name,
      })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .innerJoin(agentIdentities, eq(agentIdentities.id, oauthGrants.agentId))
      .leftJoin(users, eq(users.id, oauthGrants.userId))
      .where(
        queries.where(
          oauthGrants,
          isNull(oauthGrants.endedAt),
          filter.userId ? eq(oauthGrants.userId, filter.userId) : undefined,
        ),
      )
      .orderBy(desc(oauthGrants.createdAt));
    const ids = rows.map((row) => row.grant.id);
    const usage =
      ids.length === 0
        ? []
        : await queries.tx
            .select({ grantId: apiTokens.oauthGrantId, lastUsedAt: max(apiTokens.lastUsedAt) })
            .from(apiTokens)
            .where(queries.where(apiTokens, inArray(apiTokens.oauthGrantId, ids)))
            .groupBy(apiTokens.oauthGrantId);
    const lastUsed = new Map(usage.map((row) => [row.grantId, row.lastUsedAt]));
    return rows.map((row) => ({
      grantId: row.grant.id,
      community,
      clientName: row.clientName,
      clientUri: row.clientUri,
      redirectHost: row.redirectUris[0] ? redirectHost(row.redirectUris[0]) : null,
      agent: { id: row.grant.agentId, name: row.agentName },
      owner: { id: row.grant.userId, name: row.ownerName ?? "Former member" },
      scopes: knownScopes(row.grant.scopes),
      createdAt: row.grant.createdAt,
      lastUsedAt: lastUsed.get(row.grant.id) ?? null,
      canDisconnect: decide({
        userId: row.grant.userId,
        agentOwner: row.agentOwner,
        communityWide: row.communityWide,
      }),
    }));
  }

  async function listForCommunity(actor: Actor, communityId: string): Promise<ConnectedAppView[]> {
    const userId = sessionUser(actor);
    const role = await roleIn(communityId, userId);
    assertCan(actor, "read", "agent", { role });
    const [community] = await deps.db
      .select({ id: communities.id, slug: communities.slug, name: communities.name })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1);
    if (!community) {
      throw new AgentsError("not_found");
    }
    return scoped(communityId, (queries) =>
      grantsIn(queries, community, {}, (grant) =>
        grant.userId === userId
          ? true
          : can(
              actor,
              "manage",
              "agent",
              agentManageContext(
                role,
                { ownerId: grant.agentOwner, communityWide: grant.communityWide },
                userId,
              ),
            ),
      ),
    );
  }

  async function listForUser(actor: Actor): Promise<ConnectedAppView[]> {
    const userId = sessionUser(actor);
    const owned = await deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "oauth_grant_owner", userId);
      return tx
        .selectDistinct({
          id: communities.id,
          slug: communities.slug,
          name: communities.name,
        })
        .from(oauthGrants)
        .innerJoin(communities, eq(communities.id, oauthGrants.communityId))
        .where(
          and(
            eq(oauthGrants.userId, userId),
            isNull(oauthGrants.endedAt),
            isNull(communities.deletedAt),
          ),
        );
    });
    const lists = await Promise.all(
      owned.map((community) =>
        scoped(community.id, (queries) => grantsIn(queries, community, { userId }, () => true)),
      ),
    );
    return lists.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async function ownGrantCommunity(userId: string, grantId: string): Promise<string | null> {
    const located = await deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "oauth_grant_owner", userId);
      const [own] = await tx
        .select({ communityId: oauthGrants.communityId })
        .from(oauthGrants)
        .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
        .limit(1);
      return own ?? null;
    });
    return located?.communityId ?? null;
  }

  async function disconnect(actor: Actor, grantId: string, inCommunity?: string): Promise<void> {
    const userId = sessionUser(actor);
    if (!uuidPattern.test(grantId) || (inCommunity && !uuidPattern.test(inCommunity))) {
      throw new AgentsError("not_found");
    }
    const communityId = inCommunity ?? (await ownGrantCommunity(userId, grantId));
    if (!communityId) {
      throw new AgentsError("not_found");
    }
    const role = await roleIn(communityId, userId);
    const at = now();
    await runWithAuditSource({ actorType: "user", via: "web", tokenId: null, agentId: null }, () =>
      scoped(communityId, async (queries) => {
        const [row] = await queries.tx
          .select({
            grant: oauthGrants,
            clientName: oauthClients.clientName,
            agentOwner: agentIdentities.ownerId,
            communityWide: agentIdentities.communityWide,
          })
          .from(oauthGrants)
          .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
          .innerJoin(agentIdentities, eq(agentIdentities.id, oauthGrants.agentId))
          .where(queries.where(oauthGrants, eq(oauthGrants.id, grantId)))
          .limit(1);
        if (!row) {
          throw new AgentsError("not_found");
        }
        if (row.grant.userId !== userId) {
          assertCan(
            actor,
            "manage",
            "agent",
            agentManageContext(
              role,
              { ownerId: row.agentOwner, communityWide: row.communityWide },
              userId,
            ),
          );
        }
        const ended = await endGrant(queries, grantId, "disconnected", userId, at);
        if (ended.ended) {
          await appendAuditEntry(queries, {
            actorId: userId,
            action: "oauth.disconnected",
            target: grantId,
            metadata: {
              grantId,
              clientId: row.grant.clientId,
              clientName: row.clientName,
              agentId: row.grant.agentId,
              userId: row.grant.userId,
              tokensRevoked: ended.tokensRevoked,
            },
            at,
          });
        }
      }),
    );
  }

  return { listForCommunity, listForUser, disconnect };
}
