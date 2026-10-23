import { avatarExtensions, avatarKey, type StorageDriver } from "@cohory/storage";

const cacheBuster = /^(\?v=\d+)?$/;

export function ownAvatarUrl(
  storage: Pick<StorageDriver, "publicUrl">,
): (userId: string, url: string) => boolean {
  return (userId, url) =>
    avatarExtensions.some((extension) => {
      const base = storage.publicUrl(avatarKey(userId, extension));
      return url.startsWith(base) && cacheBuster.test(url.slice(base.length));
    });
}
