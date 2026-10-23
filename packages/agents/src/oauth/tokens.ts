import type { Scope } from "@cohory/authz";
import {
  appendAuditEntry,
  newId as defaultNewId,
  runWithAuditSource,
  setRlsValue,
  type ScopedQueries,
  type Transaction,
} from "@cohory/db";
import {
  agentIdentities,
  apiTokens,
  oauthAuthorizationCodes,
  oauthGrants,
  oauthRefreshTokens,
} from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { generateToken, hashToken, isTokenFormat } from "../token";
import { knownScopes } from "../views";
import {
  endGrant,
  findClient,
  queriesFor,
  type ClientRow,
  type GrantRow,
  type OAuthServiceDeps,
} from "./context";
import { OAuthError } from "./errors";
import { accessTokenSeconds, refreshTokenSeconds, sameResource } from "./metadata";
import { parseScopeParam, tokenRequestSchema, revocationRequestSchema } from "./schemas";
import {
  generateRefreshToken,
  isAuthorizationCodeFormat,
  isRefreshTokenFormat,
  verifyPkce,
} from "./secrets";

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: OAuthError };

function refuse<T>(code: OAuthError["code"], description: string): Outcome<T> {
  return { ok: false, error: new OAuthError(code, description) };
}

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

export function createTokenEndpoint(deps: OAuthServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;

  async function loadGrant(queries: ScopedQueries, grantId: string): Promise<GrantRow | null> {
    const [grant] = await queries.tx
      .select()
      .from(oauthGrants)
      .where(queries.where(oauthGrants, eq(oauthGrants.id, grantId)))
      .limit(1);
    return grant ?? null;
  }

  async function agentActive(queries: ScopedQueries, agentId: string): Promise<boolean> {
    const [agent] = await queries.tx
      .select({ status: agentIdentities.status })
      .from(agentIdentities)
      .where(queries.where(agentIdentities, eq(agentIdentities.id, agentId)))
      .limit(1);
    return agent?.status === "active";
  }

  function auditAs<T>(grant: GrantRow, tokenId: string | null, fn: () => Promise<T>): Promise<T> {
    return runWithAuditSource(
      { actorType: "agent", via: "api", tokenId, agentId: grant.agentId },
      fn,
    );
  }

  async function issue(
    queries: ScopedQueries,
    grant: GrantRow,
    client: ClientRow,
    scopes: readonly Scope[],
    at: Date,
  ): Promise<{ response: TokenResponse; tokenId: string }> {
    const access = generateToken();
    const refresh = generateRefreshToken();
    const tokenId = newId();
    await queries.tx.insert(apiTokens).values(
      queries.values({
        id: tokenId,
        kind: "agent",
        userId: grant.userId,
        agentId: grant.agentId,
        name: client.clientName.slice(0, 60),
        tokenHash: access.hash,
        prefix: access.prefix,
        scopes: [...scopes],
        expiresAt: new Date(at.getTime() + accessTokenSeconds * 1000),
        createdBy: grant.userId,
        createdAt: at,
        oauthGrantId: grant.id,
      }),
    );
    await queries.tx.insert(oauthRefreshTokens).values(
      queries.values({
        id: newId(),
        grantId: grant.id,
        tokenHash: refresh.hash,
        expiresAt: new Date(at.getTime() + refreshTokenSeconds * 1000),
        createdAt: at,
      }),
    );
    return {
      tokenId,
      response: {
        access_token: access.token,
        token_type: "Bearer",
        expires_in: accessTokenSeconds,
        refresh_token: refresh.value,
        scope: scopes.join(" "),
      },
    };
  }

  function auditMetadata(grant: GrantRow, client: ClientRow, extra: Record<string, unknown> = {}) {
    return {
      grantId: grant.id,
      clientId: client.id,
      clientName: client.clientName,
      agentId: grant.agentId,
      userId: grant.userId,
      ...extra,
    };
  }

  async function exchangeCode(
    client: ClientRow,
    input: { code?: string; code_verifier?: string; redirect_uri?: string; resource?: string },
  ): Promise<TokenResponse> {
    if (!input.code || !isAuthorizationCodeFormat(input.code)) {
      throw new OAuthError("invalid_grant", "The authorization code is not valid");
    }
    if (!input.code_verifier) {
      throw new OAuthError("invalid_request", "code_verifier is required");
    }
    const hash = hashToken(input.code);
    const at = now();
    const outcome = await deps.db.transaction(async (tx): Promise<Outcome<TokenResponse>> => {
      await setRlsValue(tx, "oauth_secret_hash", hash);
      const [code] = await tx
        .select()
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.codeHash, hash))
        .limit(1);
      if (!code) {
        return refuse("invalid_grant", "The authorization code is not valid");
      }
      await setRlsValue(tx, "community_id", code.communityId);
      const queries = queriesFor(tx, code.communityId);
      const grant = await loadGrant(queries, code.grantId);
      if (!grant || grant.clientId !== client.id) {
        return refuse("invalid_grant", "The authorization code is not valid");
      }
      const consumed = await tx
        .update(oauthAuthorizationCodes)
        .set({ usedAt: at })
        .where(
          and(
            eq(oauthAuthorizationCodes.communityId, code.communityId),
            eq(oauthAuthorizationCodes.id, code.id),
            isNull(oauthAuthorizationCodes.usedAt),
          ),
        )
        .returning({ id: oauthAuthorizationCodes.id });
      if (consumed.length === 0) {
        await auditAs(grant, null, async () => {
          const ended = await endGrant(queries, grant.id, "code_reuse", null, at);
          if (ended.ended) {
            await appendAuditEntry(queries, {
              actorId: grant.userId,
              action: "oauth.grant_revoked",
              target: grant.id,
              metadata: auditMetadata(grant, client, {
                reason: "code_reuse",
                tokensRevoked: ended.tokensRevoked,
              }),
              at,
            });
          }
        });
        return refuse("invalid_grant", "The authorization code was already used");
      }
      if (code.expiresAt <= at) {
        return refuse("invalid_grant", "The authorization code has expired");
      }
      if (input.redirect_uri !== code.redirectUri) {
        return refuse("invalid_grant", "redirect_uri does not match the authorization request");
      }
      if (!verifyPkce(input.code_verifier ?? "", code.codeChallenge)) {
        return refuse("invalid_grant", "code_verifier does not match the code_challenge");
      }
      if (input.resource !== undefined && !sameResource(input.resource, grant.resource)) {
        return refuse("invalid_target", `resource must be ${grant.resource}`);
      }
      if (grant.endedAt) {
        return refuse("invalid_grant", "This connection was ended");
      }
      if (!(await agentActive(queries, grant.agentId))) {
        return refuse("invalid_grant", "The agent for this connection is paused or revoked");
      }
      const scopes = knownScopes(grant.scopes);
      const issued = await issue(queries, grant, client, scopes, at);
      await auditAs(grant, issued.tokenId, () =>
        appendAuditEntry(queries, {
          actorId: grant.userId,
          action: "oauth.token_issued",
          target: grant.id,
          metadata: auditMetadata(grant, client, { tokenId: issued.tokenId, scopes }),
          at,
        }),
      );
      return { ok: true, value: issued.response };
    });
    return unwrap(outcome);
  }

  async function findRefresh(tx: Transaction, raw: string) {
    const hash = hashToken(raw);
    await setRlsValue(tx, "oauth_secret_hash", hash);
    const [row] = await tx
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hash))
      .limit(1);
    if (!row) {
      return null;
    }
    await setRlsValue(tx, "community_id", row.communityId);
    const queries = queriesFor(tx, row.communityId);
    const grant = await loadGrant(queries, row.grantId);
    return grant ? { row, grant, queries } : null;
  }

  async function refresh(
    client: ClientRow,
    input: { refresh_token?: string; scope?: string; resource?: string },
  ): Promise<TokenResponse> {
    if (!input.refresh_token || !isRefreshTokenFormat(input.refresh_token)) {
      throw new OAuthError("invalid_grant", "The refresh token is not valid");
    }
    const raw = input.refresh_token;
    const at = now();
    const outcome = await deps.db.transaction(async (tx): Promise<Outcome<TokenResponse>> => {
      const found = await findRefresh(tx, raw);
      if (!found || found.grant.clientId !== client.id) {
        return refuse("invalid_grant", "The refresh token is not valid");
      }
      const { row, grant, queries } = found;
      if (row.revokedAt || grant.endedAt) {
        return refuse("invalid_grant", "This connection was ended. Connect the app again.");
      }
      const rotated = row.rotatedAt
        ? []
        : await tx
            .update(oauthRefreshTokens)
            .set({ rotatedAt: at })
            .where(
              and(
                eq(oauthRefreshTokens.communityId, row.communityId),
                eq(oauthRefreshTokens.id, row.id),
                isNull(oauthRefreshTokens.rotatedAt),
              ),
            )
            .returning({ id: oauthRefreshTokens.id });
      if (rotated.length === 0) {
        await auditAs(grant, null, async () => {
          const ended = await endGrant(queries, grant.id, "refresh_reuse", null, at);
          await appendAuditEntry(queries, {
            actorId: grant.userId,
            action: "oauth.grant_revoked",
            target: grant.id,
            metadata: auditMetadata(grant, client, {
              reason: "refresh_reuse",
              tokensRevoked: ended.tokensRevoked,
            }),
            at,
          });
        });
        return refuse(
          "invalid_grant",
          "This refresh token was already used, so the connection was ended. Connect the app again.",
        );
      }
      if (row.expiresAt <= at) {
        return refuse("invalid_grant", "The refresh token has expired. Connect the app again.");
      }
      if (input.resource !== undefined && !sameResource(input.resource, grant.resource)) {
        return refuse("invalid_target", `resource must be ${grant.resource}`);
      }
      const granted = knownScopes(grant.scopes);
      const asked = parseScopeParam(input.scope);
      if (asked && (asked.unknown.length > 0 || asked.known.some((s) => !granted.includes(s)))) {
        return refuse("invalid_scope", "scope may only narrow the scopes of this connection");
      }
      if (!(await agentActive(queries, grant.agentId))) {
        return refuse("invalid_grant", "The agent for this connection is paused or revoked");
      }
      const scopes = asked ? asked.known : granted;
      const issued = await issue(queries, grant, client, scopes, at);
      await auditAs(grant, issued.tokenId, () =>
        appendAuditEntry(queries, {
          actorId: grant.userId,
          action: "oauth.token_refreshed",
          target: grant.id,
          metadata: auditMetadata(grant, client, { tokenId: issued.tokenId, scopes }),
          at,
        }),
      );
      return { ok: true, value: issued.response };
    });
    return unwrap(outcome);
  }

  async function token(raw: unknown): Promise<TokenResponse> {
    const parsed = tokenRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OAuthError("invalid_request", "The token request is malformed");
    }
    const input = parsed.data;
    const client = await findClient(deps.db, input.client_id);
    if (!client) {
      throw new OAuthError("invalid_client", "Unknown client_id");
    }
    if (input.grant_type === "authorization_code") {
      return exchangeCode(client, input);
    }
    if (input.grant_type === "refresh_token") {
      return refresh(client, input);
    }
    throw new OAuthError(
      "unsupported_grant_type",
      "grant_type must be authorization_code or refresh_token",
    );
  }

  async function revokeAccessToken(client: ClientRow, raw: string, at: Date): Promise<void> {
    const hash = hashToken(raw);
    await deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "api_token_hash", hash);
      const [row] = await tx.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).limit(1);
      if (!row?.oauthGrantId) {
        return;
      }
      await setRlsValue(tx, "community_id", row.communityId);
      const queries = queriesFor(tx, row.communityId);
      const grant = await loadGrant(queries, row.oauthGrantId);
      if (!grant || grant.clientId !== client.id || row.revokedAt) {
        return;
      }
      await tx
        .update(apiTokens)
        .set({ revokedAt: at })
        .where(queries.where(apiTokens, eq(apiTokens.id, row.id)));
      await auditAs(grant, row.id, () =>
        appendAuditEntry(queries, {
          actorId: grant.userId,
          action: "oauth.token_revoked",
          target: grant.id,
          metadata: auditMetadata(grant, client, { tokenId: row.id }),
          at,
        }),
      );
    });
  }

  async function revoke(raw: unknown): Promise<void> {
    const parsed = revocationRequestSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.token) {
      throw new OAuthError("invalid_request", "token is required");
    }
    const client = await findClient(deps.db, parsed.data.client_id);
    if (!client) {
      throw new OAuthError("invalid_client", "Unknown client_id");
    }
    const value = parsed.data.token;
    const at = now();
    if (isTokenFormat(value)) {
      await revokeAccessToken(client, value, at);
      return;
    }
    if (!isRefreshTokenFormat(value)) {
      return;
    }
    await deps.db.transaction(async (tx) => {
      const found = await findRefresh(tx, value);
      if (!found || found.grant.clientId !== client.id) {
        return;
      }
      const { grant, queries } = found;
      await auditAs(grant, null, async () => {
        const ended = await endGrant(queries, grant.id, "revoked", null, at);
        if (ended.ended) {
          await appendAuditEntry(queries, {
            actorId: grant.userId,
            action: "oauth.grant_revoked",
            target: grant.id,
            metadata: auditMetadata(grant, client, {
              reason: "revoked",
              tokensRevoked: ended.tokensRevoked,
            }),
            at,
          });
        }
      });
    });
  }

  return { token, revoke };
}
