import { communityIdSchema, getDb } from "@cohory/db";
import {
  createUploadGuard,
  getFairUseConfig,
  paidTierWindowStart,
  tierFromPaidActivity,
  type FairUseConfig,
  type FairUseTier,
  type UploadGuard,
} from "@cohory/fair-use";
import { communityPrefix, getStorage, type StorageDriver } from "@cohory/storage";

import { createPostgresCommunitiesRepository } from "./postgres-repository";
import type { CommunitiesRepository } from "./repository";

export async function fairUseTier(
  hasPaidTransactionSince: (since: Date) => Promise<boolean>,
  now: Date,
): Promise<FairUseTier> {
  return tierFromPaidActivity(await hasPaidTransactionSince(paidTierWindowStart(now)));
}

export interface CommunityUploadGuardDeps {
  readonly config: FairUseConfig;
  readonly repo: Pick<CommunitiesRepository, "hasPaidTransactionSince">;
  readonly storage: Pick<StorageDriver, "usedBytes">;
}

export function createCommunityUploadGuard(deps: CommunityUploadGuardDeps): UploadGuard {
  return createUploadGuard({
    config: deps.config,
    tierOf: (communityId) => {
      const id = communityIdSchema.parse(communityId);
      return fairUseTier((since) => deps.repo.hasPaidTransactionSince(id, since), new Date());
    },
    usedBytes: (communityId) => deps.storage.usedBytes(communityPrefix(communityId)),
  });
}

export { createPostgresCommunitiesRepository };

let defaultGuard: UploadGuard | undefined;

export function getCommunityUploadGuard(): UploadGuard {
  defaultGuard ??= createCommunityUploadGuard({
    config: getFairUseConfig(),
    repo: createPostgresCommunitiesRepository(getDb()),
    storage: getStorage(),
  });
  return defaultGuard;
}
