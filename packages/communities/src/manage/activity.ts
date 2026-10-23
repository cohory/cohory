import { getDb, type CommunityId } from "@cohory/db";

import { createPostgresManageRepository } from "./postgres-repository";
import type { ManageRepository } from "./repository";

export const lastSeenBatchSize = 500;
const communityPageSize = 500;

export interface LastSeenBackfillOptions {
  readonly batchSize?: number;
  readonly communityIds?: readonly CommunityId[];
}

export interface LastSeenBackfillResult {
  readonly communities: number;
  readonly updated: number;
  readonly batches: number;
}

async function* communitiesOf(
  repo: ManageRepository,
  only: readonly CommunityId[] | undefined,
): AsyncGenerator<CommunityId> {
  if (only) {
    yield* only;
    return;
  }
  let after: string | null = null;
  for (;;) {
    const page = await repo.listCommunityIds(after, communityPageSize);
    yield* page;
    const last = page.at(-1);
    if (page.length < communityPageSize || !last) {
      return;
    }
    after = last;
  }
}

export async function backfillLastSeen(
  repo: ManageRepository,
  options: LastSeenBackfillOptions = {},
): Promise<LastSeenBackfillResult> {
  const batchSize = options.batchSize ?? lastSeenBatchSize;
  let communities = 0;
  let updated = 0;
  let batches = 0;
  for await (const communityId of communitiesOf(repo, options.communityIds)) {
    communities += 1;
    for (;;) {
      const batch = await repo.backfillLastSeen(communityId, batchSize);
      batches += 1;
      updated += batch.updated;
      if (batch.updated < batchSize) {
        break;
      }
    }
  }
  return { communities, updated, batches };
}

export function backfillMemberLastSeen(): Promise<LastSeenBackfillResult> {
  return backfillLastSeen(createPostgresManageRepository(getDb()));
}
