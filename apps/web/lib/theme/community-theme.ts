import type { AppearanceView } from "@cohory/communities";
import type { CSSProperties } from "react";

export type ThemeAppearance = Pick<
  AppearanceView,
  "accent" | "font" | "cardStyle" | "theme" | "cssVariables" | "tokens"
>;

export type CustomProperties = CSSProperties & Record<`--${string}`, string>;

export interface CommunityThemeProps {
  readonly className?: string;
  readonly style?: CustomProperties;
  readonly "data-theme"?: "light" | "dark";
  readonly "data-force-theme"?: "light" | "dark";
  readonly "data-card-style"?: AppearanceView["cardStyle"];
  readonly "data-community-accent"?: "";
  readonly "data-community-root"?: "";
}

const accentVariables = [
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-foreground",
  "--color-accent-muted",
  "--color-ring",
] as const;

const safeValue = /^#[0-9A-F]{6}$/i;

export const fontClassNames: Readonly<Record<AppearanceView["font"], string>> = {
  inter: "community-font-inter",
  "source-serif": "community-font-source-serif",
  "nunito-sans": "community-font-nunito-sans",
};

export function themeAttribute(theme: AppearanceView["theme"]): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

export function isDefaultAppearance(appearance: ThemeAppearance): boolean {
  return (
    appearance.accent === null &&
    appearance.font === "inter" &&
    appearance.cardStyle === "minimal" &&
    appearance.theme === "system"
  );
}

export function accentStyle(variables: ThemeAppearance["cssVariables"]): CustomProperties | null {
  const style: CustomProperties = {};
  for (const name of accentVariables) {
    const light = variables.light[name];
    const dark = variables.dark[name];
    if (!safeValue.test(light) || !safeValue.test(dark)) {
      return null;
    }
    const token = name.slice(2);
    style[`--community-light-${token}`] = light;
    style[`--community-dark-${token}`] = dark;
  }
  return style;
}

function usableAccent(appearance: ThemeAppearance): CustomProperties | null {
  return appearance.accent !== null && !appearance.tokens.fallbackUsed
    ? accentStyle(appearance.cssVariables)
    : null;
}

// Dialogs, menus, and toasts render in a portal outside the community wrapper, so the accent
// variables also go on :root while a community page is mounted.
export function accentRootCss(appearance: ThemeAppearance): string | null {
  const accent = usableAccent(appearance);
  if (!accent) {
    return null;
  }
  const declarations = Object.entries(accent).map(([name, value]) => `${name}:${String(value)};`);
  return `:root{${declarations.join("")}}`;
}

export function communityThemeProps(appearance: ThemeAppearance): CommunityThemeProps {
  if (isDefaultAppearance(appearance)) {
    return {};
  }
  const accent = usableAccent(appearance);
  const theme = themeAttribute(appearance.theme);
  return {
    className: fontClassNames[appearance.font],
    "data-community-root": "",
    "data-card-style": appearance.cardStyle,
    ...(theme ? { "data-theme": theme, "data-force-theme": theme } : {}),
    ...(accent ? { style: accent, "data-community-accent": "" } : {}),
  };
}
