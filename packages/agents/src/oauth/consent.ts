import {
  availableScopes,
  can,
  ForbiddenError,
  scopeListSchema,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type Scope,
} from "@cohory/authz";
import {
  appendAuditEntry,
  getMembership,
  listCommunitiesForUser,
  newId as defaultNewId,
  parseCommunityId,
  runInCommunity,
  runWithAuditSource,
  withCommunity,
} from "@cohory/db";
import {
  agentIdentities,
  oauthAuthorizationCodes,
  oauthClients,
  oauthGrants,
} from "@cohory/db/schema";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import { knownScopes } from "../views";
import { checkAuthorizationRequest, errorRedirect, type AuthorizationRequest } from "./authorize";
import { uuidPattern, type OAuthServiceDeps } from "./context";
import { ConsentError } from "./errors";
import { authorizationCodeSeconds } from "./metadata";
import { redirectHost, withQuery } from "./redirect-uri";
import { consentChoiceSchema, type ConsentAgentChoice } from "./schemas";
import { generateAuthorizationCode } from "./secrets";

export interface ConsentAgent {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
}

export interface ConsentCommunity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly agents: readonly ConsentAgent[];
  readonly available: readonly Scope[];
  readonly preferredAgentId: string | null;
}

export interface ConsentApp {
  readonly clientId: string;
  readonly redirectHost: string;
}

export interface ApproveInput {
  readonly request: unknown;
  readonly communityId: string;
  readonly agent: ConsentAgentChoice;
  readonly scopes: readonly string[];
}

export type ConsentResult =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "redirect"; readonly url: string };

function sessionUser(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  if (actor.credential) {
    throw new ForbiddenError("create", "agent");
  }
  return actor.userId;
}

export function createConsent(deps: OAuthServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;

  async function creatorRole(
    actor: Actor,
    communityId: string,
    userId: string,
  ): Promise<CommunityRole | null> {
    const membership = await getMembership(
      withCommunity(deps.db, parseCommunityId(communityId)),
      userId,
    );
    const role = membership?.status === "active" ? membership.role : null;
    return role !== null && can(actor, "create", "agent", { role }) ? role : null;
  }

  async function options(actor: Actor, app?: ConsentApp): Promise<ConsentCommunity[]> {
    const userId = sessionUser(actor);
    const memberships = await listCommunitiesForUser(deps.db, userId);
    const eligible = memberships.filter(({ membership }) =>
      can(actor, "create", "agent", { role: membership.role }),
    );
    const [client] =
      app && uuidPattern.test(app.clientId)
        ? await deps.db
            .select({ id: oauthClients.id, name: oauthClients.clientName })
            .from(oauthClients)
            .where(eq(oauthClients.id, app.clientId))
            .limit(1)
        : [];
    return Promise.all(
      eligible.map(async ({ community, membership }) => {
        const { agents, preferredAgentId } = await runInCommunity(
          withCommunity(deps.db, community.id),
          async (queries) => {
            const own = await queries.tx
              .select({
                id: agentIdentities.id,
                name: agentIdentities.name,
                scopes: agentIdentities.scopes,
              })
              .from(agentIdentities)
              .where(
                queries.where(
                  agentIdentities,
                  eq(agentIdentities.ownerId, userId),
                  eq(agentIdentities.status, "active"),
                ),
              )
              .orderBy(asc(agentIdentities.name));
            if (!client || own.length === 0) {
              return { agents: own, preferredAgentId: null };
            }
            const earlier = await queries.tx
              .select({
                agentId: oauthGrants.agentId,
                clientId: oauthGrants.clientId,
                redirectUris: oauthClients.redirectUris,
              })
              .from(oauthGrants)
              .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
              .where(
                queries.where(
                  oauthGrants,
                  eq(oauthGrants.userId, userId),
                  inArray(
                    oauthGrants.agentId,
                    own.map((agent) => agent.id),
                  ),
                  or(eq(oauthClients.id, client.id), eq(oauthClients.clientName, client.name)),
                ),
              )
              .orderBy(desc(oauthGrants.createdAt))
              .limit(50);
            const same = earlier.find(
              (grant) =>
                grant.clientId === client.id ||
                grant.redirectUris.some((uri) => redirectHost(uri) === app?.redirectHost),
            );
            return { agents: own, preferredAgentId: same?.agentId ?? null };
          },
        );
        return {
          id: community.id,
          slug: community.slug,
          name: community.name,
          agents: agents.map((agent) => ({ ...agent, scopes: knownScopes(agent.scopes) })),
          available: availableScopes(membership.role, "agent"),
          preferredAgentId,
        };
      }),
    );
  }

  async function approve(actor: Actor, input: ApproveInput): Promise<ConsentResult> {
    const userId = sessionUser(actor);
    const check = await checkAuthorizationRequest(deps, input.request);
    if (check.kind !== "ok") {
      return check;
    }
    const request: AuthorizationRequest = check.request;
    const choice = consentChoiceSchema.safeParse(input.agent);
    if (!choice.success) {
      throw new ConsentError("invalid_name");
    }
    const chosen = scopeListSchema.safeParse(input.scopes);
    if (!chosen.success) {
      throw new ConsentError("no_scopes");
    }
    if (!uuidPattern.test(input.communityId)) {
      throw new ConsentError("not_allowed");
    }
    const role = await creatorRole(actor, input.communityId, userId);
    if (role === null) {
      throw new ConsentError("not_allowed");
    }
    const grantable = availableScopes(role, "agent");
    const code = generateAuthorizationCode();
    const at = now();
    await runWithAuditSource({ actorType: "user", via: "web", tokenId: null, agentId: null }, () =>
      runInCommunity(
        withCommunity(deps.db, parseCommunityId(input.communityId)),
        async (queries) => {
          let agentId: string;
          let scopes: Scope[];
          if (choice.data.kind === "existing") {
            const [agent] = await queries.tx
              .select()
              .from(agentIdentities)
              .where(
                queries.where(
                  agentIdentities,
                  and(
                    eq(agentIdentities.id, choice.data.agentId),
                    eq(agentIdentities.ownerId, userId),
                  ),
                ),
              )
              .limit(1);
            if (!agent) {
              throw new ConsentError("agent_not_found");
            }
            if (agent.status !== "active") {
              throw new ConsentError("agent_not_active");
            }
            scopes = chosen.data.filter((scope) => agent.scopes.includes(scope));
            agentId = agent.id;
          } else {
            scopes = chosen.data.filter((scope) => grantable.includes(scope));
            agentId = newId();
            await queries.tx.insert(agentIdentities).values(
              queries.values({
                id: agentId,
                ownerId: userId,
                name: choice.data.name,
                description: `Connected through ${request.client.name}`.slice(0, 280),
                scopes,
                communityWide: false,
                createdBy: userId,
                createdAt: at,
                updatedAt: at,
              }),
            );
            await appendAuditEntry(queries, {
              actorId: userId,
              action: "agent.created",
              target: agentId,
              metadata: { name: choice.data.name, scopes, communityWide: false, oauth: true },
              at,
            });
          }
          if (scopes.length === 0) {
            throw new ConsentError("no_scopes");
          }
          const grantId = newId();
          await queries.tx.insert(oauthGrants).values(
            queries.values({
              id: grantId,
              clientId: request.client.id,
              userId,
              agentId,
              scopes,
              resource: request.resource,
              createdAt: at,
            }),
          );
          await queries.tx.insert(oauthAuthorizationCodes).values(
            queries.values({
              id: newId(),
              grantId,
              codeHash: code.hash,
              codeChallenge: request.codeChallenge,
              redirectUri: request.redirectUri,
              expiresAt: new Date(at.getTime() + authorizationCodeSeconds * 1000),
              createdAt: at,
            }),
          );
          await appendAuditEntry(queries, {
            actorId: userId,
            action: "oauth.grant_created",
            target: grantId,
            metadata: {
              clientId: request.client.id,
              clientName: request.client.name,
              agentId,
              userId,
              scopes,
              redirectHost: request.redirectHost,
            },
            at,
          });
        },
      ),
    );
    return {
      kind: "redirect",
      url: withQuery(request.redirectUri, {
        code: code.value,
        ...(request.state ? { state: request.state } : {}),
        iss: deps.issuer.issuer,
      }),
    };
  }

  async function deny(actor: Actor, raw: unknown): Promise<ConsentResult> {
    sessionUser(actor);
    const check = await checkAuthorizationRequest(deps, raw);
    if (check.kind !== "ok") {
      return check;
    }
    return {
      kind: "redirect",
      url: errorRedirect(
        deps.issuer.issuer,
        check.request.redirectUri,
        check.request.state,
        "access_denied",
        "The person cancelled the connection",
      ),
    };
  }

  return { options, approve, deny };
}
