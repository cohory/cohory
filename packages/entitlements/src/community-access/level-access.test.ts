import { describe, expect, it } from "vitest";

import { levelUnlocked } from "./level-access";

describe("levelUnlocked", () => {
  it("opens content that has no required level to everyone", () => {
    expect(levelUnlocked({ role: null, level: 1, requiredLevel: null })).toBe(true);
    expect(levelUnlocked({ role: "member", level: 1, requiredLevel: null })).toBe(true);
  });

  it("keeps content locked for a member below the required level", () => {
    expect(levelUnlocked({ role: "member", level: 2, requiredLevel: 3 })).toBe(false);
  });

  it("unlocks content for a member at the required level", () => {
    expect(levelUnlocked({ role: "member", level: 3, requiredLevel: 3 })).toBe(true);
  });

  it("unlocks content for a member above the required level", () => {
    expect(levelUnlocked({ role: "member", level: 9, requiredLevel: 3 })).toBe(true);
  });

  it.each(["owner", "admin", "moderator"] as const)(
    "lets a %s past the lock whatever their level",
    (role) => {
      expect(levelUnlocked({ role, level: 1, requiredLevel: 9 })).toBe(true);
    },
  );

  it("keeps content locked for someone who is not a member", () => {
    expect(levelUnlocked({ role: null, level: 9, requiredLevel: 2 })).toBe(false);
  });
});
