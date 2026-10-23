import type { AccentModeTokens } from "@cohory/db/schema";
import { clampChroma, converter, formatHex, wcagContrast, type Oklch } from "culori";

export const defaultAccent = "#2563EB";
export const lightBackground = "#F8FAFC";
export const darkSurfaceRaised = "#1C2330";

const lightMutedBase = "#FFFFFF";
const darkMutedBase = "#151B24";
const lightTextOnAccent = ["#FFFFFF", "#111827"] as const;
const darkTextOnAccent = ["#0B1120", "#FFFFFF"] as const;
const dangerHex = "#C52A2A";

const minContrast = 4.5;
const lightnessStep = 0.01;
const hoverShift = 0.06;
const maxIterations = 50;
const lightMutedMix = 0.08;
const darkMutedMix = 0.14;
const mixStep = 0.01;
const redHueWindow = 20;
const redChromaThreshold = 0.1;

export const defaultAccentTokens = {
  light: {
    accent: "#2563EB",
    accentHover: "#1D4ED8",
    accentForeground: "#FFFFFF",
    accentMuted: "#EFF4FF",
    ring: "#2563EB",
  },
  dark: {
    accent: "#60A5FA",
    accentHover: "#93C5FD",
    accentForeground: "#0B1120",
    accentMuted: "#16233D",
    ring: "#60A5FA",
  },
} as const satisfies { light: AccentModeTokens; dark: AccentModeTokens };

export const accentMessages = {
  fallback: "This color can't be made readable. We're using the default blue.",
  red_hue: "Red accents can be confused with errors.",
} as const;

export interface ContrastRatios {
  readonly accentOnBackground: number;
  readonly foregroundOnAccent: number;
  readonly accentOnMuted: number;
}

export interface AccentDerivation {
  readonly light: AccentModeTokens;
  readonly dark: AccentModeTokens;
  readonly ratios: { readonly light: ContrastRatios; readonly dark: ContrastRatios };
  readonly fallbackUsed: boolean;
  readonly fallbackReason: "invalid" | "unreadable" | null;
  readonly warning: "red_hue" | null;
}

const hexPattern = /^#[0-9A-Fa-f]{6}$/;
const toOklch = converter("oklch");
const toOklab = converter("oklab");

function hex(color: Oklch): string {
  return formatHex(clampChroma(color, "oklch")).toUpperCase();
}

function withLightness(base: Oklch, lightness: number): string {
  return hex({ ...base, l: Math.min(1, Math.max(0, lightness)) });
}

function round(ratio: number): number {
  return Math.round(ratio * 100) / 100;
}

function adjustUntilReadable(base: Oklch, against: string, direction: 1 | -1): string | null {
  for (let step = 0; step <= maxIterations; step += 1) {
    const candidate = withLightness(base, base.l + direction * step * lightnessStep);
    if (wcagContrast(candidate, against) >= minContrast) {
      return candidate;
    }
  }
  return null;
}

function mixInto(base: string, accent: string, amount: number): string {
  const from = toOklab(base);
  const to = toOklab(accent);
  if (!from || !to) {
    throw new Error("color conversion failed");
  }
  const lerp = (a: number, b: number) => a + (b - a) * amount;
  return formatHex({
    mode: "oklab",
    l: lerp(from.l, to.l),
    a: lerp(from.a, to.a),
    b: lerp(from.b, to.b),
  }).toUpperCase();
}

function readableMuted(base: string, accent: string, mix: number): string | null {
  for (let amount = mix; amount >= -1e-9; amount -= mixStep) {
    const candidate = mixInto(base, accent, Math.max(0, amount));
    if (wcagContrast(accent, candidate) >= minContrast) {
      return candidate;
    }
  }
  return null;
}

function foregroundFor(accent: string, options: readonly [string, string]): string | null {
  return options.find((text) => wcagContrast(text, accent) >= minContrast) ?? null;
}

interface ModeSpec {
  readonly against: string;
  readonly direction: 1 | -1;
  readonly foregrounds: readonly [string, string];
  readonly mutedBase: string;
  readonly mutedMix: number;
}

const lightSpec: ModeSpec = {
  against: lightBackground,
  direction: -1,
  foregrounds: lightTextOnAccent,
  mutedBase: lightMutedBase,
  mutedMix: lightMutedMix,
};

const darkSpec: ModeSpec = {
  against: darkSurfaceRaised,
  direction: 1,
  foregrounds: darkTextOnAccent,
  mutedBase: darkMutedBase,
  mutedMix: darkMutedMix,
};

function deriveMode(base: Oklch, spec: ModeSpec): AccentModeTokens | null {
  const accent = adjustUntilReadable(base, spec.against, spec.direction);
  if (!accent) {
    return null;
  }
  const accentForeground = foregroundFor(accent, spec.foregrounds);
  const accentMuted = readableMuted(spec.mutedBase, accent, spec.mutedMix);
  if (!accentForeground || !accentMuted) {
    return null;
  }
  const accentColor = toOklch(accent);
  if (!accentColor) {
    return null;
  }
  return {
    accent,
    accentHover: withLightness(accentColor, accentColor.l + spec.direction * hoverShift),
    accentForeground,
    accentMuted,
    ring: accent,
  };
}

function ratiosFor(tokens: AccentModeTokens, against: string): ContrastRatios {
  return {
    accentOnBackground: round(wcagContrast(tokens.accent, against)),
    foregroundOnAccent: round(wcagContrast(tokens.accentForeground, tokens.accent)),
    accentOnMuted: round(wcagContrast(tokens.accent, tokens.accentMuted)),
  };
}

function result(
  light: AccentModeTokens,
  dark: AccentModeTokens,
  extra: Pick<AccentDerivation, "fallbackUsed" | "fallbackReason" | "warning">,
): AccentDerivation {
  return {
    light,
    dark,
    ratios: { light: ratiosFor(light, lightBackground), dark: ratiosFor(dark, darkSurfaceRaised) },
    ...extra,
  };
}

function defaults(fallbackReason: AccentDerivation["fallbackReason"]): AccentDerivation {
  return result(defaultAccentTokens.light, defaultAccentTokens.dark, {
    fallbackUsed: fallbackReason !== null,
    fallbackReason,
    warning: null,
  });
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const dangerHue = toOklch(dangerHex)?.h ?? 0;

function isRedHue(color: Oklch): boolean {
  return (
    color.c >= redChromaThreshold &&
    color.h !== undefined &&
    hueDistance(color.h, dangerHue) <= redHueWindow
  );
}

export function deriveAccentTokens(input: string | null | undefined): AccentDerivation {
  if (input === null || input === undefined) {
    return defaults(null);
  }
  if (!hexPattern.test(input)) {
    return defaults("invalid");
  }
  const normalized = input.toUpperCase();
  if (normalized === defaultAccent) {
    return defaults(null);
  }
  const base = toOklch(normalized);
  if (!base) {
    return defaults("invalid");
  }
  const light = deriveMode(base, lightSpec);
  const dark = deriveMode(base, darkSpec);
  if (!light || !dark) {
    return defaults("unreadable");
  }
  return result(light, dark, {
    fallbackUsed: false,
    fallbackReason: null,
    warning: isRedHue(base) ? "red_hue" : null,
  });
}
