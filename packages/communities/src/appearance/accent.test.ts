import { converter, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

import {
  accentMessages,
  darkSurfaceRaised,
  defaultAccentTokens,
  deriveAccentTokens,
  lightBackground,
  type AccentDerivation,
} from "./accent";

const toOklch = converter("oklch");

function hueOf(hex: string): number {
  return toOklch(hex)?.h ?? Number.NaN;
}

function expectReadable(result: AccentDerivation): void {
  const { light, dark } = result;
  expect(wcagContrast(light.accent, lightBackground)).toBeGreaterThanOrEqual(4.5);
  expect(wcagContrast(light.accentForeground, light.accent)).toBeGreaterThanOrEqual(4.5);
  expect(wcagContrast(light.accent, light.accentMuted)).toBeGreaterThanOrEqual(4.5);
  expect(wcagContrast(dark.accent, darkSurfaceRaised)).toBeGreaterThanOrEqual(4.5);
  expect(wcagContrast(dark.accentForeground, dark.accent)).toBeGreaterThanOrEqual(4.5);
  expect(wcagContrast(dark.accent, dark.accentMuted)).toBeGreaterThanOrEqual(4.5);
  expect(light.ring).toBe(light.accent);
  expect(dark.ring).toBe(dark.accent);
}

describe("deriveAccentTokens", () => {
  it.each(["#2563EB", "#2563eb"])("passes the default accent %s through untouched", (input) => {
    const result = deriveAccentTokens(input);

    expect(result.light).toEqual(defaultAccentTokens.light);
    expect(result.dark).toEqual(defaultAccentTokens.dark);
    expect(result.light).toEqual({
      accent: "#2563EB",
      accentHover: "#1D4ED8",
      accentForeground: "#FFFFFF",
      accentMuted: "#EFF4FF",
      ring: "#2563EB",
    });
    expect(result.fallbackUsed).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("uses the default tokens without a fallback flag when no accent is set", () => {
    const result = deriveAccentTokens(null);

    expect(result.light).toEqual(defaultAccentTokens.light);
    expect(result.fallbackUsed).toBe(false);
  });

  it("darkens a very light yellow until it reaches 4.5:1 on the background", () => {
    const result = deriveAccentTokens("#FFFFE0");

    expect(result.fallbackUsed).toBe(false);
    expect(result.light.accent).not.toBe("#FFFFE0");
    const ratio = wcagContrast(result.light.accent, lightBackground);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(5);
    expect(Math.abs(hueOf(result.light.accent) - hueOf("#FFFFE0"))).toBeLessThan(15);
    expectReadable(result);
  });

  it("keeps an accent that is already readable in light mode", () => {
    const result = deriveAccentTokens("#0F766E");

    expect(result.light.accent).toBe("#0F766E");
    expect(result.light.accentForeground).toBe("#FFFFFF");
    expect(result.dark.accent).not.toBe("#0F766E");
    expectReadable(result);
  });

  it("lightens the dark accent and uses dark text on it", () => {
    const result = deriveAccentTokens("#7C3AED");

    expect(result.dark.accentForeground).toBe("#0B1120");
    expectReadable(result);
  });

  it("moves hover away from the accent in each mode", () => {
    const result = deriveAccentTokens("#0F766E");

    expect(toOklch(result.light.accentHover)?.l).toBeLessThan(toOklch(result.light.accent)?.l ?? 0);
    expect(toOklch(result.dark.accentHover)?.l).toBeGreaterThan(
      toOklch(result.dark.accent)?.l ?? 1,
    );
  });

  it.each(["blue", "#FFF", "#GGGGGG", "", "2563EB", "#2563EB ", "#2563EBFF"])(
    "falls back to the default tokens for invalid input %j",
    (input) => {
      const result = deriveAccentTokens(input);

      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackReason).toBe("invalid");
      expect(result.light).toEqual(defaultAccentTokens.light);
      expect(result.dark).toEqual(defaultAccentTokens.dark);
    },
  );

  it("falls back when near black cannot reach 4.5:1 on dark surfaces within 50 steps", () => {
    const result = deriveAccentTokens("#050505");

    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe("unreadable");
    expect(result.light).toEqual(defaultAccentTokens.light);
    expect(accentMessages.fallback).toBe(
      "This color can't be made readable. We're using the default blue.",
    );
  });

  it("derives readable tokens for near white", () => {
    const result = deriveAccentTokens("#FEFEFE");

    expect(result.fallbackUsed).toBe(false);
    expectReadable(result);
  });

  it.each(["#FF0000", "#E11D48", "#C52A2A", "#DC2626"])(
    "warns but does not block a red accent %s",
    (input) => {
      const result = deriveAccentTokens(input);

      expect(result.warning).toBe("red_hue");
      expect(result.fallbackUsed).toBe(false);
      expectReadable(result);
    },
  );

  it.each(["#2563EB", "#0F766E", "#FFFF00", "#F9A8D4"])(
    "does not warn for the non red or low chroma accent %s",
    (input) => {
      expect(deriveAccentTokens(input).warning).toBeNull();
    },
  );

  it("reports the contrast ratios it enforced", () => {
    const result = deriveAccentTokens("#0F766E");

    expect(result.ratios.light.accentOnBackground).toBeCloseTo(
      wcagContrast(result.light.accent, lightBackground),
      2,
    );
    expect(result.ratios.dark.accentOnMuted).toBeCloseTo(
      wcagContrast(result.dark.accent, result.dark.accentMuted),
      2,
    );
  });

  it.each([
    "#FFFF00",
    "#00FF00",
    "#00FFFF",
    "#FF00FF",
    "#F97316",
    "#14B8A6",
    "#A3E635",
    "#1E3A8A",
    "#831843",
    "#808080",
  ])("keeps every pair readable for %s or falls back", (input) => {
    const result = deriveAccentTokens(input);

    expectReadable(result);
    expect(result.light.accent).toMatch(/^#[0-9A-F]{6}$/);
  });
});
