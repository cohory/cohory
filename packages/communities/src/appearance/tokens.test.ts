import { describe, expect, it } from "vitest";

import { defaultAccentTokens } from "./accent";
import { appearanceToCssVariables, deriveAppearanceTokens, resolveAppearance } from "./tokens";

describe("resolveAppearance", () => {
  it("fills the documented defaults for an empty appearance", () => {
    expect(resolveAppearance({})).toEqual({
      accent: null,
      logoKey: null,
      coverKey: null,
      font: "inter",
      cardStyle: "minimal",
      theme: "system",
    });
  });
});

describe("deriveAppearanceTokens", () => {
  it("combines the accent derivation with font, card style, and theme", () => {
    const tokens = deriveAppearanceTokens({
      accent: "#0F766E",
      font: "source-serif",
      theme: "dark",
    });

    expect(tokens.light.accent).toBe("#0F766E");
    expect(tokens.font).toBe("source-serif");
    expect(tokens.cardStyle).toBe("minimal");
    expect(tokens.theme).toBe("dark");
    expect(tokens.fallbackUsed).toBe(false);
  });

  it("records a fallback and keeps the default tokens for an invalid accent", () => {
    const tokens = deriveAppearanceTokens({ accent: "teal" });

    expect(tokens.fallbackUsed).toBe(true);
    expect(tokens.light).toEqual(defaultAccentTokens.light);
  });
});

describe("appearanceToCssVariables", () => {
  it("maps the default tokens to CSS variables for both modes", () => {
    const variables = appearanceToCssVariables(deriveAppearanceTokens({}));

    expect(variables.light).toEqual({
      "--color-accent": "#2563EB",
      "--color-accent-hover": "#1D4ED8",
      "--color-accent-foreground": "#FFFFFF",
      "--color-accent-muted": "#EFF4FF",
      "--color-ring": "#2563EB",
      "--font-heading": "var(--font-sans)",
      "--card-radius": "var(--radius-lg)",
      "--card-shadow": "none",
    });
    expect(variables.dark).toEqual({
      "--color-accent": "#60A5FA",
      "--color-accent-hover": "#93C5FD",
      "--color-accent-foreground": "#0B1120",
      "--color-accent-muted": "#16233D",
      "--color-ring": "#60A5FA",
    });
  });

  it("maps the soft card style and a curated heading font", () => {
    const variables = appearanceToCssVariables(
      deriveAppearanceTokens({ cardStyle: "soft", font: "nunito-sans" }),
    );

    expect(variables.light["--card-radius"]).toBe("var(--radius-xl)");
    expect(variables.light["--card-shadow"]).toBe("var(--card-shadow-soft)");
    expect(variables.light["--font-heading"]).toBe(
      '"Nunito Sans", ui-sans-serif, system-ui, sans-serif',
    );
  });
});
