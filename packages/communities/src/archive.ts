import { CommunityArchivedError } from "./errors";

export { CommunityArchivedError };

export interface ArchivableCommunity {
  readonly archivedAt: Date | null;
}

export function isCommunityArchived(community: ArchivableCommunity): boolean {
  return community.archivedAt !== null;
}

export function assertCommunityWritable(community: ArchivableCommunity): void {
  if (isCommunityArchived(community)) {
    throw new CommunityArchivedError();
  }
}
