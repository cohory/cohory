import type { ApiCredential, CommunityRole, Scope } from "@cohory/authz";
import { findMembershipIn, parseCommunityId, setRlsValue, type Database } from "@cohory/db";
import { agentIdentities, apiTokens, communities } from "@cohory/db/schema";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { InvalidTokenError, type InvalidTokenReason } from "./errors";
import { hashesMatch, hashToken, isTokenFormat } from "./token";
import { knownScopes } from "./views";

export const touchIntervalMs = 60_000;

export type TokenStanding = "member" | "lapsed";

export type TokenChannel = "api" | "mcp";

export const lapsedAgentScopes: readonly Scope[] = ["courses:read", "proposals:write"];

export interface AuthenticatedToken {
  readonly userId: string;
  readonly communitySlug: string;
  readonly role: CommunityRole;
  readonly standing: TokenStanding;
  readonly credential: ApiCredential;
  readonly oauthGrantId: string | null;
}

type Outcome =
  | { readonly kind: "ok"; readonly value: AuthenticatedToken }
  | { readonly kind: "refused"; readonly reason: InvalidTokenReason; readonly oauth?: boolean };

function refused(reason: InvalidTokenReason, oauth = false): Outcome {
  return { kind: "refused", reason, oauth };
}

export function personalTokenEnded(
  token: { readonly createdAt: Date },
  membership: { readonly status: string; readonly joinedAt: Date | null } | null | undefined,
): boolean {
  if (membership?.status !== "active") {
    return true;
  }
  return membership.joinedAt !== null && membership.joinedAt > token.createdAt;
}

export async function authenticateToken(
  db: Database,
  raw: string,
  now: Date,
  channel: TokenChannel = "api",
): Promise<AuthenticatedToken> {
  if (!isTokenFormat(raw)) {
    throw new InvalidTokenError("malformed");
  }
  const hash = hashToken(raw);
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    await setRlsValue(tx, "api_token_hash", hash);
    const [token] = await tx.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).limit(1);
    if (!token || !hashesMatch(token.tokenHash, hash)) {
      return refused("unknown");
    }
    await setRlsValue(tx, "community_id", token.communityId);
    const oauth = token.oauthGrantId !== null;
    if (token.revokedAt || token.createdBy !== token.userId) {
      return refused("revoked", oauth);
    }
    if (token.expiresAt <= now) {
      return refused("expired", oauth);
    }
    const [community] = await tx
      .select({ slug: communities.slug })
      .from(communities)
      .where(and(eq(communities.id, token.communityId), isNull(communities.deletedAt)))
      .limit(1);
    if (!community) {
      return refused("unknown");
    }
    const membership = await findMembershipIn(
      { tx, communityId: parseCommunityId(token.communityId) },
      token.userId,
    );
    if (token.kind === "personal" && personalTokenEnded(token, membership)) {
      await tx
        .update(apiTokens)
        .set({ revokedAt: now })
        .where(and(eq(apiTokens.communityId, token.communityId), eq(apiTokens.id, token.id)));
      return refused(membership?.status === "active" ? "revoked" : "membership_required");
    }
    const role = membership?.status === "active" ? membership.role : null;
    const isMember = role !== null;
    let standing: TokenStanding = "member";
    const stale = sql`${new Date(now.getTime() - touchIntervalMs).toISOString()}::timestamptz`;
    let scopes = knownScopes(token.scopes);

    if (token.agentId) {
      const [agent] = await tx
        .select()
        .from(agentIdentities)
        .where(
          and(
            eq(agentIdentities.communityId, token.communityId),
            eq(agentIdentities.id, token.agentId),
          ),
        )
        .limit(1);
      if (!agent || agent.status === "revoked") {
        return refused("agent_revoked");
      }
      if (agent.status === "suspended") {
        return refused("agent_suspended");
      }
      const lapsed =
        !isMember &&
        agent.ownerId === token.userId &&
        membership?.status === "removed" &&
        !agent.communityWide &&
        knownScopes(agent.scopes).includes("proposals:write");
      if (!lapsed && (!isMember || agent.ownerId !== token.userId)) {
        await tx
          .update(agentIdentities)
          .set({ status: "suspended", suspendedAt: now })
          .where(
            and(
              eq(agentIdentities.communityId, token.communityId),
              eq(agentIdentities.id, agent.id),
            ),
          );
        return refused("agent_suspended");
      }
      const agentScopes = knownScopes(agent.scopes);
      scopes = token.oauthGrantId
        ? agentScopes.filter((scope) => token.scopes.includes(scope))
        : agentScopes;
      if (lapsed) {
        standing = "lapsed";
        scopes = scopes.filter((scope) => lapsedAgentScopes.includes(scope));
      }
      await tx
        .update(agentIdentities)
        .set({ lastActivityAt: now })
        .where(
          and(
            eq(agentIdentities.communityId, token.communityId),
            eq(agentIdentities.id, agent.id),
            or(isNull(agentIdentities.lastActivityAt), lt(agentIdentities.lastActivityAt, stale)),
          ),
        );
    }
    if (role === null && standing !== "lapsed") {
      return refused("membership_required");
    }

    await tx
      .update(apiTokens)
      .set({ lastUsedAt: now, lastUsedVia: channel })
      .where(
        and(
          eq(apiTokens.communityId, token.communityId),
          eq(apiTokens.id, token.id),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, stale)),
        ),
      );

    return {
      kind: "ok",
      value: {
        userId: token.userId,
        communitySlug: community.slug,
        role: role ?? "member",
        standing,
        oauthGrantId: token.oauthGrantId,
        credential: {
          type: token.agentId ? "agent" : "user",
          tokenId: token.id,
          agentId: token.agentId,
          communityId: token.communityId,
          scopes,
          via: "api",
        },
      },
    };
  });
  if (outcome.kind === "refused") {
    throw new InvalidTokenError(outcome.reason, { oauth: outcome.oauth });
  }
  return outcome.value;
}
