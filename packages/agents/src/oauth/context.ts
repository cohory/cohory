import { parseCommunityId, type Database, type ScopedQueries, type Transaction } from "@cohory/db";
import { apiTokens, oauthClients, oauthGrants, oauthRefreshTokens } from "@cohory/db/schema";
import type { OAuthGrantEndReason } from "@cohory/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { OAuthIssuer } from "./metadata";

export interface OAuthServiceDeps {
  readonly db: Database;
  readonly issuer: OAuthIssuer;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export type ClientRow = typeof oauthClients.$inferSelect;
export type GrantRow = typeof oauthGrants.$inferSelect;

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function queriesFor(tx: Transaction, communityId: string): ScopedQueries {
  const id = parseCommunityId(communityId);
  return {
    communityId: id,
    tx,
    where: (table, ...conditions) => and(eq(table.communityId, id), ...conditions) ?? sql`false`,
    values: (input) => ({ ...input, communityId: id }),
  };
}

export async function findClient(
  db: Database | Transaction,
  clientId: string | undefined,
): Promise<ClientRow | null> {
  if (!clientId || !uuidPattern.test(clientId)) {
    return null;
  }
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  return row ?? null;
}

export async function endGrant(
  queries: ScopedQueries,
  grantId: string,
  reason: OAuthGrantEndReason,
  endedBy: string | null,
  at: Date,
): Promise<{ ended: boolean; tokensRevoked: number }> {
  const ended = await queries.tx
    .update(oauthGrants)
    .set({ endedAt: at, endReason: reason, endedBy })
    .where(queries.where(oauthGrants, eq(oauthGrants.id, grantId), isNull(oauthGrants.endedAt)))
    .returning({ id: oauthGrants.id });
  await queries.tx
    .update(oauthRefreshTokens)
    .set({ revokedAt: at })
    .where(
      queries.where(
        oauthRefreshTokens,
        eq(oauthRefreshTokens.grantId, grantId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    );
  const tokens = await queries.tx
    .update(apiTokens)
    .set({ revokedAt: at, revokedBy: endedBy })
    .where(
      queries.where(apiTokens, eq(apiTokens.oauthGrantId, grantId), isNull(apiTokens.revokedAt)),
    )
    .returning({ id: apiTokens.id });
  return { ended: ended.length > 0, tokensRevoked: tokens.length };
}
