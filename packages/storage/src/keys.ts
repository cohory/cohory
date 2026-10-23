import { z } from "zod";

import { StorageError } from "./errors";

const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const maxKeyLength = 512;

declare const storageKeyBrand: unique symbol;
export type StorageKey = string & { readonly [storageKeyBrand]: true };

const uuid = z.uuid();

function isValidSegment(segment: string): boolean {
  return segmentPattern.test(segment) && !segment.includes("..");
}

export function parseStorageKey(raw: string): StorageKey {
  if (raw.length === 0 || raw.length > maxKeyLength) {
    throw new StorageError("invalid_key", "The file key is empty or too long.");
  }
  const segments = raw.split("/");
  if (!segments.every(isValidSegment)) {
    throw new StorageError("invalid_key", "The file key contains a segment that is not allowed.");
  }
  return raw as StorageKey;
}

export function isStorageKey(raw: string): raw is StorageKey {
  try {
    parseStorageKey(raw);
    return true;
  } catch {
    return false;
  }
}

export function communityKey(communityId: string, ...path: string[]): StorageKey {
  if (path.length === 0) {
    throw new StorageError(
      "invalid_key",
      "A community file key needs a path inside the community.",
    );
  }
  return parseStorageKey(["communities", uuid.parse(communityId), ...path].join("/"));
}

declare const storagePrefixBrand: unique symbol;
export type StoragePrefix = string & { readonly [storagePrefixBrand]: true };

export function communityPrefix(communityId: string): StoragePrefix {
  return `communities/${uuid.parse(communityId)}/` as StoragePrefix;
}

export const avatarExtensions = ["png", "jpg", "webp", "gif"] as const;
export type AvatarExtension = (typeof avatarExtensions)[number];

export function avatarKey(userId: string, extension: AvatarExtension): StorageKey {
  return parseStorageKey(`users/${uuid.parse(userId)}/avatar.${extension}`);
}

const avatarKeyPattern =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar\.(png|jpg|webp|gif)$/;

export function isPublicKey(key: StorageKey): boolean {
  return avatarKeyPattern.test(key);
}
