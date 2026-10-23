import { getDb, setRlsValue, type Database, type Transaction } from "@cohory/db";
import {
  apiTokens,
  communities,
  oauthClients,
  oauthGrants,
  oauthRefreshTokens,
} from "@cohory/db/schema";
import { and, asc, eq, exists, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

export const clientRetentionDays = 30;
export const clientPruneBatchSize = 500;

const dayMs = 24 * 60 * 60 * 1000;

export interface OAuthClientPruneResult {
  readonly scanned: number;
  readonly pruned: number;
}

export interface OAuthClientPruneDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly communities?: () => Promise<readonly string[]>;
}

export type OAuthClientPrune = () => Promise<OAuthClientPruneResult>;

interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

async function clientsInUse(
  tx: Transaction,
  communityId: string,
  clientIds: readonly string[],
  at: Date,
  cutoff: Date,
): Promise<string[]> {
  await setRlsValue(tx, "community_id", communityId);
  const liveOrRecentAccess = tx
    .select({ one: sql`1` })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.communityId, communityId),
        eq(apiTokens.oauthGrantId, oauthGrants.id),
        or(
          and(isNull(apiTokens.revokedAt), gt(apiTokens.expiresAt, at)),
          gt(apiTokens.createdAt, cutoff),
        ),
      ),
    );
  const liveOrRecentRefresh = tx
    .select({ one: sql`1` })
    .from(oauthRefreshTokens)
    .where(
      and(
        eq(oauthRefreshTokens.communityId, communityId),
        eq(oauthRefreshTokens.grantId, oauthGrants.id),
        or(
          and(
            isNull(oauthRefreshTokens.revokedAt),
            isNull(oauthRefreshTokens.rotatedAt),
            gt(oauthRefreshTokens.expiresAt, at),
          ),
          gt(oauthRefreshTokens.createdAt, cutoff),
        ),
      ),
    );
  const rows = await tx
    .selectDistinct({ clientId: oauthGrants.clientId })
    .from(oauthGrants)
    .where(
      and(
        eq(oauthGrants.communityId, communityId),
        inArray(oauthGrants.clientId, [...clientIds]),
        or(
          isNull(oauthGrants.endedAt),
          gt(oauthGrants.createdAt, cutoff),
          exists(liveOrRecentAccess),
          exists(liveOrRecentRefresh),
        ),
      ),
    );
  return rows.map((row) => row.clientId);
}

/**
 * Grants and tokens sit behind row level security, so usage is read one community at a time.
 * Candidates stay locked while they are checked: a consent for one of them waits on the foreign
 * key and then fails, instead of committing a grant that the delete would cascade away.
 */
export function createOAuthClientPrune(deps: OAuthClientPruneDeps): OAuthClientPrune {
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? clientPruneBatchSize;
  const listCommunities =
    deps.communities ??
    (async () =>
      (await deps.db.select({ id: communities.id }).from(communities)).map((row) => row.id));

  async function prunePage(
    after: Cursor | null,
    limit: number,
    at: Date,
    cutoff: Date,
    communityIds: readonly string[],
  ): Promise<{ last: Cursor; scanned: number; pruned: number } | null> {
    return deps.db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: oauthClients.id, createdAt: oauthClients.createdAt })
        .from(oauthClients)
        .where(
          and(
            lte(oauthClients.createdAt, cutoff),
            after
              ? or(
                  gt(oauthClients.createdAt, after.createdAt),
                  and(eq(oauthClients.createdAt, after.createdAt), gt(oauthClients.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(oauthClients.createdAt), asc(oauthClients.id))
        .limit(batchSize)
        .for("update", { skipLocked: true });
      const last = candidates.at(-1);
      if (!last) {
        return null;
      }
      const ids = candidates.map((row) => row.id);
      const inUse = new Set<string>();
      for (const communityId of communityIds) {
        for (const id of await clientsInUse(tx, communityId, ids, at, cutoff)) {
          inUse.add(id);
        }
      }
      const unused = ids.filter((id) => !inUse.has(id)).slice(0, limit);
      const deleted =
        unused.length === 0
          ? []
          : await tx
              .delete(oauthClients)
              .where(inArray(oauthClients.id, unused))
              .returning({ id: oauthClients.id });
      return { last, scanned: ids.length, pruned: deleted.length };
    });
  }

  return async () => {
    const at = now();
    const cutoff = new Date(at.getTime() - clientRetentionDays * dayMs);
    const communityIds = await listCommunities();
    let scanned = 0;
    let pruned = 0;
    let cursor: Cursor | null = null;
    while (pruned < batchSize) {
      const page = await prunePage(cursor, batchSize - pruned, at, cutoff, communityIds);
      if (!page) {
        break;
      }
      scanned += page.scanned;
      pruned += page.pruned;
      cursor = page.last;
      if (page.scanned < batchSize) {
        break;
      }
    }
    return { scanned, pruned };
  };
}

let defaultPrune: OAuthClientPrune | undefined;

export function getOAuthClientPrune(): OAuthClientPrune {
  defaultPrune ??= createOAuthClientPrune({ db: getDb() });
  return defaultPrune;
}
