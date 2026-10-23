import { describe, expect, it } from "vitest";

import { StorageError } from "./errors";
import { avatarKey, communityKey, isPublicKey, parseStorageKey } from "./keys";
import { communityId, userId } from "./test/images";

describe("storage keys", () => {
  it("builds the avatar key under the user folder", () => {
    expect(avatarKey(userId, "png")).toBe(`users/${userId}/avatar.png`);
  });

  it("builds community keys under the community folder", () => {
    expect(communityKey(communityId, "posts", "cover.webp")).toBe(
      `communities/${communityId}/posts/cover.webp`,
    );
  });

  it("rejects ids that are not uuids", () => {
    expect(() => avatarKey("../etc", "png")).toThrow();
    expect(() => communityKey("abc", "file.png")).toThrow();
  });

  it.each([
    "",
    "/absolute.png",
    "../escape.png",
    "users/../../escape.png",
    "users/./avatar.png",
    "users//avatar.png",
    "users\\avatar.png",
    "users/.hidden",
    "users/a..b.png",
    "users/%2e%2e/avatar.png",
    `users/${"a".repeat(600)}`,
  ])("rejects the unsafe key %j", (raw) => {
    expect(() => parseStorageKey(raw)).toThrow(StorageError);
  });

  it("treats only avatar keys as public", () => {
    expect(isPublicKey(avatarKey(userId, "jpg"))).toBe(true);
    expect(isPublicKey(communityKey(communityId, "private.pdf"))).toBe(false);
    expect(isPublicKey(parseStorageKey(`users/${userId}/avatar.pdf`))).toBe(false);
  });
});
