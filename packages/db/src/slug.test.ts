import { describe, expect, it } from "vitest";

import { communitySlugSchema } from "./slug";

describe("communitySlugSchema", () => {
  it.each(["abc", "my-community", "a1-b2-c3", "x".repeat(48)])("accepts %s", (slug) => {
    expect(communitySlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ["too short", "ab"],
    ["too long", "x".repeat(49)],
    ["uppercase", "My-Community"],
    ["leading hyphen", "-abc"],
    ["trailing hyphen", "abc-"],
    ["double hyphen", "ab--cd"],
    ["underscore", "ab_cd"],
    ["space", "ab cd"],
    ["non ASCII", "café"],
  ])("rejects %s", (_label, slug) => {
    expect(communitySlugSchema.safeParse(slug).success).toBe(false);
  });
});
