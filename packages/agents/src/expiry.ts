import { getDb, parseCommunityId, runInCommunity, withCommunity, type Database } from "@cohory/db";
import { agentIdentities, apiTokens, communities, memberships } from "@cohory/db/schema";
import {
  getTokenExpiryNotifier,
  type TokenExpiryNotice,
  type TokenExpiryNotifier,
} from "@cohory/notifications";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

export const expiryNoticeDays = 7;

const dayMs = 24 * 60 * 60 * 1000;

export interface TokenExpirySweepResult {
  readonly noticed: number;
  readonly failed: number;
}

export interface SweptCommunity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface TokenExpirySweepDeps {
  readonly db: Database;
  readonly notify: TokenExpiryNotifier;
  readonly onNoticeError?: (tokenId: string, error: unknown) => void;
  readonly now?: () => Date;
  readonly communities?: () => Promise<readonly SweptCommunity[]>;
}

export type TokenExpirySweep = () => Promise<TokenExpirySweepResult>;

export function createTokenExpirySweep(deps: TokenExpirySweepDeps): TokenExpirySweep {
  const now = deps.now ?? (() => new Date());
  const listCommunities =
    deps.communities ??
    (() =>
      deps.db
        .select({ id: communities.id, slug: communities.slug, name: communities.name })
        .from(communities)
        .where(isNull(communities.deletedAt)));

  async function markNoticed(communityId: string, tokenId: string, at: Date): Promise<void> {
    await runInCommunity(withCommunity(deps.db, parseCommunityId(communityId)), (q) =>
      q.tx
        .update(apiTokens)
        .set({ expiryNotifiedAt: at })
        .where(q.where(apiTokens, eq(apiTokens.id, tokenId), isNull(apiTokens.expiryNotifiedAt))),
    );
  }

  async function dueIn(community: SweptCommunity, at: Date): Promise<TokenExpiryNotice[]> {
    const horizon = new Date(at.getTime() + expiryNoticeDays * dayMs);
    return runInCommunity(withCommunity(deps.db, parseCommunityId(community.id)), async (q) => {
      const due = await q.tx
        .select({
          id: apiTokens.id,
          userId: apiTokens.userId,
          name: apiTokens.name,
          kind: apiTokens.kind,
          expiresAt: apiTokens.expiresAt,
          agentName: agentIdentities.name,
        })
        .from(apiTokens)
        .innerJoin(
          memberships,
          and(
            eq(memberships.communityId, apiTokens.communityId),
            eq(memberships.userId, apiTokens.userId),
            eq(memberships.status, "active"),
          ),
        )
        .leftJoin(
          agentIdentities,
          and(
            eq(agentIdentities.communityId, apiTokens.communityId),
            eq(agentIdentities.id, apiTokens.agentId),
          ),
        )
        .where(
          q.where(
            apiTokens,
            isNull(apiTokens.revokedAt),
            isNull(apiTokens.oauthGrantId),
            isNull(apiTokens.expiryNotifiedAt),
            eq(apiTokens.createdBy, apiTokens.userId),
            gt(apiTokens.expiresAt, at),
            lte(apiTokens.expiresAt, horizon),
            lte(
              apiTokens.createdAt,
              sql`${apiTokens.expiresAt} - make_interval(days => ${expiryNoticeDays})`,
            ),
            or(isNull(apiTokens.agentId), eq(agentIdentities.status, "active")),
          ),
        );
      return due.map((row) => ({
        communityId: community.id,
        communitySlug: community.slug,
        communityName: community.name,
        tokenId: row.id,
        userId: row.userId,
        tokenName: row.name,
        agentName: row.kind === "agent" ? row.agentName : null,
        expiresAt: row.expiresAt,
      }));
    });
  }

  return async () => {
    const at = now();
    const live = await listCommunities();
    let noticed = 0;
    let failed = 0;
    for (const community of live) {
      for (const notice of await dueIn(community, at)) {
        try {
          await deps.notify(notice);
          await markNoticed(notice.communityId, notice.tokenId, at);
          noticed += 1;
        } catch (error: unknown) {
          failed += 1;
          deps.onNoticeError?.(notice.tokenId, error);
        }
      }
    }
    return { noticed, failed };
  };
}

let defaultSweep: TokenExpirySweep | undefined;

export function getTokenExpirySweep(
  appUrl: string,
  onNoticeError?: (tokenId: string, error: unknown) => void,
): TokenExpirySweep {
  defaultSweep ??= createTokenExpirySweep({
    db: getDb(),
    notify: getTokenExpiryNotifier(appUrl),
    ...(onNoticeError ? { onNoticeError } : {}),
  });
  return defaultSweep;
}
