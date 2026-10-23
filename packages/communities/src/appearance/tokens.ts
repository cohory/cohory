import type {
  AccentModeTokens,
  AppearanceTokens,
  CardStyleOption,
  CommunityAppearance,
  FontOption,
  ThemeOption,
} from "@cohory/db/schema";

import { deriveAccentTokens } from "./accent";

export interface ResolvedAppearance {
  readonly accent: string | null;
  readonly logoKey: string | null;
  readonly coverKey: string | null;
  readonly font: FontOption;
  readonly cardStyle: CardStyleOption;
  readonly theme: ThemeOption;
}

export const fontStacks: Readonly<Record<FontOption, string>> = {
  inter: "var(--font-sans)",
  "source-serif": '"Source Serif 4", ui-serif, Georgia, serif',
  "nunito-sans": '"Nunito Sans", ui-sans-serif, system-ui, sans-serif',
};

const cardStyles: Readonly<Record<CardStyleOption, { radius: string; shadow: string }>> = {
  minimal: { radius: "var(--radius-lg)", shadow: "none" },
  soft: { radius: "var(--radius-xl)", shadow: "var(--card-shadow-soft)" },
};

export function resolveAppearance(appearance: CommunityAppearance): ResolvedAppearance {
  return {
    accent: appearance.accent ?? null,
    logoKey: appearance.logoKey ?? null,
    coverKey: appearance.coverKey ?? null,
    font: appearance.font ?? "inter",
    cardStyle: appearance.cardStyle ?? "minimal",
    theme: appearance.theme ?? "system",
  };
}

export function deriveAppearanceTokens(appearance: CommunityAppearance): AppearanceTokens {
  const resolved = resolveAppearance(appearance);
  const accent = deriveAccentTokens(resolved.accent);
  return {
    light: accent.light,
    dark: accent.dark,
    ratios: accent.ratios,
    font: resolved.font,
    cardStyle: resolved.cardStyle,
    theme: resolved.theme,
    fallbackUsed: accent.fallbackUsed,
    warning: accent.warning,
  };
}

export type AccentCssVariable =
  | "--color-accent"
  | "--color-accent-hover"
  | "--color-accent-foreground"
  | "--color-accent-muted"
  | "--color-ring";

export type AppearanceCssVariable =
  AccentCssVariable | "--font-heading" | "--card-radius" | "--card-shadow";

export interface AppearanceCssVariables {
  readonly light: Readonly<Record<AppearanceCssVariable, string>>;
  readonly dark: Readonly<Record<AccentCssVariable, string>>;
}

function accentVariables(tokens: AccentModeTokens): Record<AccentCssVariable, string> {
  return {
    "--color-accent": tokens.accent,
    "--color-accent-hover": tokens.accentHover,
    "--color-accent-foreground": tokens.accentForeground,
    "--color-accent-muted": tokens.accentMuted,
    "--color-ring": tokens.ring,
  };
}

export function appearanceToCssVariables(tokens: AppearanceTokens): AppearanceCssVariables {
  const card = cardStyles[tokens.cardStyle];
  return {
    light: {
      ...accentVariables(tokens.light),
      "--font-heading": fontStacks[tokens.font],
      "--card-radius": card.radius,
      "--card-shadow": card.shadow,
    },
    dark: accentVariables(tokens.dark),
  };
}
