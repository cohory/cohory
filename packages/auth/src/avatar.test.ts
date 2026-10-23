import { describe, expect, it } from "vitest";

import { ownAvatarUrl } from "./avatar";

const userId = "0199e7a0-0000-7000-8000-000000000001";
const otherUserId = "0199e7a0-0000-7000-8000-000000000002";
const belongsTo = ownAvatarUrl({ publicUrl: (key) => `https://cdn.example.test/${key}` });

describe("ownAvatarUrl", () => {
  it("accepts the member's stored avatar with or without the cache buster", () => {
    expect(belongsTo(userId, `https://cdn.example.test/users/${userId}/avatar.png`)).toBe(true);
    expect(belongsTo(userId, `https://cdn.example.test/users/${userId}/avatar.webp?v=17`)).toBe(
      true,
    );
  });

  it("refuses another member's avatar", () => {
    expect(belongsTo(userId, `https://cdn.example.test/users/${otherUserId}/avatar.png`)).toBe(
      false,
    );
  });

  it("refuses outside URLs and extra query or path parts", () => {
    expect(belongsTo(userId, "https://tracker.example/pixel.png")).toBe(false);
    expect(belongsTo(userId, `https://cdn.example.test/users/${userId}/avatar.svg`)).toBe(false);
    expect(belongsTo(userId, `https://cdn.example.test/users/${userId}/avatar.png?v=1&x=2`)).toBe(
      false,
    );
    expect(belongsTo(userId, `https://cdn.example.test/users/${userId}/avatar.png/../x`)).toBe(
      false,
    );
  });
});
