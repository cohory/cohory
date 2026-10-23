import {
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
  type RlsFlag,
  type ScopedQueries,
} from "@cohory/db";

const managerFlags: readonly RlsFlag[] = [
  "migration_manager",
  "community_manager",
  "course_manager",
  "calendar_manager",
  "payments_manager",
];

export type MigrationTx = ScopedQueries["tx"];

export async function actAs(tx: MigrationTx, userId: string): Promise<void> {
  await setRlsValue(tx, "user_id", userId);
}

export function inMigrationScope<T>(
  db: Database,
  communityId: string,
  fn: (queries: ScopedQueries) => Promise<T>,
): Promise<T> {
  return runInCommunity(withCommunity(db, parseCommunityId(communityId)), fn, {
    flags: managerFlags,
  });
}
