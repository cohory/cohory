import {
  appendAuditEntry,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
} from "@cohory/db";
import { apiTokens, memberships, oauthGrants } from "@cohory/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { endGrant } from "./oauth/context";

export interface RevokedCredentials {
  readonly tokensRevoked: number;
  readonly grantsEnded: number;
}

async function credentialCommunities(db: Database, userId: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "user_id", userId);
    await setRlsValue(tx, "oauth_grant_owner", userId);
    await setRlsValue(tx, "api_token_owner", userId);
    const [members, grants, tokens] = await Promise.all([
      tx
        .select({ communityId: memberships.communityId })
        .from(memberships)
        .where(eq(memberships.userId, userId)),
      tx
        .select({ communityId: oauthGrants.communityId })
        .from(oauthGrants)
        .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.endedAt))),
      tx
        .select({ communityId: apiTokens.communityId })
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))),
    ]);
    return [...new Set([...members, ...grants, ...tokens].map((row) => row.communityId))];
  });
}

export async function revokeAllCredentials(
  db: Database,
  userId: string,
  at: Date,
): Promise<RevokedCredentials> {
  let tokensRevoked = 0;
  let grantsEnded = 0;
  for (const communityId of await credentialCommunities(db, userId)) {
    await runInCommunity(withCommunity(db, parseCommunityId(communityId)), async (queries) => {
      const grants = await queries.tx
        .select({ id: oauthGrants.id })
        .from(oauthGrants)
        .where(
          queries.where(oauthGrants, eq(oauthGrants.userId, userId), isNull(oauthGrants.endedAt)),
        );
      let ended = 0;
      for (const grant of grants) {
        const result = await endGrant(queries, grant.id, "revoked", userId, at);
        ended += result.ended ? 1 : 0;
        tokensRevoked += result.tokensRevoked;
      }
      const tokens = await queries.tx
        .update(apiTokens)
        .set({ revokedAt: at, revokedBy: userId })
        .where(queries.where(apiTokens, eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
        .returning({ id: apiTokens.id });
      tokensRevoked += tokens.length;
      grantsEnded += ended;
      if (tokens.length > 0 || ended > 0) {
        await appendAuditEntry(queries, {
          actorId: userId,
          action: "account.credentials_revoked",
          target: userId,
          metadata: {
            reason: "password_changed",
            tokensRevoked: tokens.length,
            grantsEnded: ended,
          },
          at,
        });
      }
    });
  }
  return { tokensRevoked, grantsEnded };
}
