import { appearanceToCssVariables, deriveAppearanceTokens } from "@cohory/communities";
import { describe, expect, it } from "vitest";

import {
  accentRootCss,
  communityThemeProps,
  themeAttribute,
  type ThemeAppearance,
} from "./community-theme";

const color = (digits: string) => `#${digits}`;

function appearance(input: {
  accent?: string | null;
  font?: ThemeAppearance["font"];
  cardStyle?: ThemeAppearance["cardStyle"];
  theme?: ThemeAppearance["theme"];
}): ThemeAppearance {
  const tokens = deriveAppearanceTokens(input);
  return {
    accent: input.accent ?? null,
    font: tokens.font,
    cardStyle: tokens.cardStyle,
    theme: tokens.theme,
    tokens,
    cssVariables: appearanceToCssVariables(tokens),
  };
}

describe("themeAttribute", () => {
  it("leaves system to the device and sets explicit modes", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("communityThemeProps", () => {
  it("adds nothing for the default appearance so the page renders as before", () => {
    expect(communityThemeProps(appearance({}))).toEqual({});
  });

  it("sets light and dark accent variables, font class, and card style", () => {
    const props = communityThemeProps(
      appearance({ accent: color("16A34A"), font: "nunito-sans", cardStyle: "minimal" }),
    );
    expect(props.className).toBe("community-font-nunito-sans");
    expect(props["data-card-style"]).toBe("minimal");
    expect(props["data-community-accent"]).toBe("");
    expect(props["data-theme"]).toBeUndefined();
    expect(props.style?.["--community-light-color-accent"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(props.style?.["--community-dark-color-accent"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(props.style?.["--community-light-color-accent"]).not.toBe(
      props.style?.["--community-dark-color-accent"],
    );
  });

  it("sets data-theme only for an explicit mode", () => {
    expect(communityThemeProps(appearance({ theme: "dark" }))["data-theme"]).toBe("dark");
    expect(communityThemeProps(appearance({ theme: "light" }))["data-theme"]).toBe("light");
    expect(
      communityThemeProps(appearance({ cardStyle: "soft", theme: "system" })),
    ).not.toHaveProperty("data-theme");
  });

  it("asks the page to force an explicit mode and leaves system to the device", () => {
    expect(communityThemeProps(appearance({ theme: "dark" }))["data-force-theme"]).toBe("dark");
    expect(communityThemeProps(appearance({ theme: "light" }))["data-force-theme"]).toBe("light");
    expect(
      communityThemeProps(appearance({ accent: color("16A34A"), theme: "system" })),
    ).not.toHaveProperty("data-force-theme");
  });

  it("keeps the default accent when the stored color fell back", () => {
    const props = communityThemeProps(
      appearance({ accent: color("050505"), font: "source-serif" }),
    );
    expect(props.style).toBeUndefined();
    expect(props).not.toHaveProperty("data-community-accent");
    expect(props.className).toBe("community-font-source-serif");
  });

  it("refuses variable values that are not hex colors", () => {
    const base = appearance({ accent: color("16A34A") });
    const tampered: ThemeAppearance = {
      ...base,
      cssVariables: {
        ...base.cssVariables,
        light: { ...base.cssVariables.light, "--color-accent": "red; } body { display: none" },
      },
    };
    expect(communityThemeProps(tampered).style).toBeUndefined();
  });
});

describe("accentRootCss", () => {
  it("puts both accent variants on the page root so dialogs and menus pick them up", () => {
    const css = accentRootCss(appearance({ accent: color("16A34A") }));
    expect(css).toMatch(/^:root\{--community-light-color-accent:#[0-9A-F]{6};/i);
    expect(css).toContain("--community-dark-color-ring:");
  });

  it("returns nothing for the default or a fallen back accent", () => {
    expect(accentRootCss(appearance({}))).toBeNull();
    expect(accentRootCss(appearance({ accent: color("050505") }))).toBeNull();
  });

  it("refuses values that are not hex colors", () => {
    const base = appearance({ accent: color("16A34A") });
    const tampered: ThemeAppearance = {
      ...base,
      cssVariables: {
        ...base.cssVariables,
        dark: { ...base.cssVariables.dark, "--color-ring": "red}body{display:none" },
      },
    };
    expect(accentRootCss(tampered)).toBeNull();
  });
});

describe("communityThemeProps root marker", () => {
  it("marks the community root so page level rules can find it", () => {
    expect(communityThemeProps(appearance({ cardStyle: "soft" }))).toHaveProperty(
      "data-community-root",
      "",
    );
  });
});
