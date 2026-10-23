import type { FairUseConfig, FairUseLimits, FairUseTier } from "./config";
import { hasUploadLimits, limitsFor } from "./config";
import { LimitReachedError } from "./errors";

export function assertMemberCapacity(limits: FairUseLimits, activeMembers: number): void {
  if (limits.members !== null && activeMembers >= limits.members) {
    throw new LimitReachedError("members", limits.members, activeMembers);
  }
}

export function assertUploadSize(limits: FairUseLimits, incomingBytes: number): void {
  if (limits.uploadBytes !== null && incomingBytes > limits.uploadBytes) {
    throw new LimitReachedError("upload", limits.uploadBytes, incomingBytes);
  }
}

export function assertStorageCapacity(
  limits: FairUseLimits,
  usedBytes: number,
  incomingBytes: number,
): void {
  if (limits.storageBytes !== null && usedBytes + incomingBytes > limits.storageBytes) {
    throw new LimitReachedError("storage", limits.storageBytes, usedBytes);
  }
}

export type UploadGuard = (communityId: string, incomingBytes: number) => Promise<void>;

export interface UploadGuardDeps {
  readonly config: FairUseConfig;
  readonly tierOf: (communityId: string) => Promise<FairUseTier>;
  readonly usedBytes: (communityId: string) => Promise<number>;
}

export const allowAllUploads: UploadGuard = () => Promise.resolve();

export function createUploadGuard(deps: UploadGuardDeps): UploadGuard {
  if (!hasUploadLimits(deps.config)) {
    return allowAllUploads;
  }
  return async (communityId, incomingBytes) => {
    const limits = limitsFor(deps.config, await deps.tierOf(communityId));
    assertUploadSize(limits, incomingBytes);
    if (limits.storageBytes === null) {
      return;
    }
    assertStorageCapacity(limits, await deps.usedBytes(communityId), incomingBytes);
  };
}
