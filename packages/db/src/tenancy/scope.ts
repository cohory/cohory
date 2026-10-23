import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database } from "../client";
import { setRlsFlags, setRlsValue, type RlsFlag } from "./session";

export const communityIdSchema = z.uuid().brand<"CommunityId">();

export type CommunityId = z.infer<typeof communityIdSchema>;

export function parseCommunityId(value: unknown): CommunityId {
  return communityIdSchema.parse(value);
}

export class TenantScopeRequiredError extends Error {
  constructor() {
    super("tenant scope required");
    this.name = "TenantScopeRequiredError";
  }
}

export interface CommunityScope {
  readonly kind: "community";
  readonly communityId: CommunityId;
  readonly db: Database;
}

export function withCommunity(db: Database, communityId: CommunityId): CommunityScope {
  return { kind: "community", communityId: parseCommunityId(communityId), db };
}

export function requireCommunityScope(scope: CommunityScope | null | undefined): CommunityScope {
  if (scope?.kind !== "community" || !communityIdSchema.safeParse(scope.communityId).success) {
    throw new TenantScopeRequiredError();
  }
  return scope;
}

export type TenantTable = PgTable & {
  readonly communityId: AnyPgColumn<{ data: string; notNull: true }>;
};

export type DetachedTenantTable = PgTable & {
  readonly communityId: AnyPgColumn<{ data: string; notNull: false }>;
};

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ScopedQueries {
  readonly communityId: CommunityId;
  readonly tx: Transaction;
  where(table: TenantTable | DetachedTenantTable, ...conditions: (SQL | undefined)[]): SQL;
  values<V extends object>(input: V & { communityId?: never }): V & { communityId: CommunityId };
}

export interface CommunitySessionOptions {
  readonly userId?: string;
  readonly flags?: readonly RlsFlag[];
}

export async function runInCommunity<T>(
  scope: CommunityScope | null | undefined,
  fn: (queries: ScopedQueries) => Promise<T>,
  options: CommunitySessionOptions = {},
): Promise<T> {
  const { db, communityId } = requireCommunityScope(scope);
  return db.transaction(async (tx) => {
    await setRlsValue(tx, "community_id", communityId);
    if (options.userId) {
      await setRlsValue(tx, "user_id", options.userId);
    }
    await setRlsFlags(tx, options.flags ?? []);
    return fn({
      communityId,
      tx,
      where: (table, ...conditions) =>
        and(eq(table.communityId, communityId), ...conditions) ?? sql`false`,
      values: (input) => ({ ...input, communityId }),
    });
  });
}
