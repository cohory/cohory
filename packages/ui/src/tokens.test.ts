import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const colorsSchema = z.object({
  cssVariablePrefix: z.literal("--color-"),
  modes: z.object({
    light: z.record(z.string(), z.string()),
    dark: z.record(z.string(), z.string()),
  }),
});

const colors = colorsSchema.parse(
  JSON.parse(readFileSync(new URL("../../../assets/brand/colors.json", import.meta.url), "utf8")),
);
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function blockBody(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start === -1) {
    throw new Error(`Block "${opener}" not found in tokens.css`);
  }
  const bodyStart = start + opener.length;
  const end = source.indexOf("}", bodyStart);
  return source.slice(bodyStart, end);
}

function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9*-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      result.set(name, value.trim());
    }
  }
  return result;
}

const light = declarations(blockBody(css, "@theme {"));
const dark = declarations(blockBody(css, '[data-theme="dark"] {'));

describe("tokens.css", () => {
  it.each(Object.entries(colors.modes.light))(
    "defines light --color-%s with the value from colors.json",
    (token, value) => {
      expect(light.get(`--color-${token}`)).toBe(value);
    },
  );

  it.each(Object.entries(colors.modes.dark))(
    "defines dark --color-%s with the value from colors.json",
    (token, value) => {
      expect(dark.get(`--color-${token}`)).toBe(value);
    },
  );

  it("removes the default Tailwind palette", () => {
    expect(light.get("--color-*")).toBe("initial");
  });

  it("gives the Soft card style its own shadow in both modes", () => {
    const base = declarations(blockBody(css, "@layer base {\n  :root {"));
    expect(base.get("--card-shadow-soft")).toBe(
      "0 1px 3px rgba(17, 24, 39, 0.08), 0 4px 12px rgba(17, 24, 39, 0.06)",
    );
    expect(dark.get("--card-shadow-soft")).toBe(
      "0 1px 3px rgba(0, 0, 0, 0.6), 0 6px 16px rgba(0, 0, 0, 0.5)",
    );
  });

  it("maps each card style to its radius and shadow, portalled dialogs included", () => {
    const soft = declarations(
      blockBody(css, ':root:has([data-community-root][data-card-style="soft"]) {'),
    );
    const minimal = declarations(
      blockBody(css, ':root:has([data-community-root][data-card-style="minimal"]) {'),
    );
    expect(soft.get("--card-radius")).toBe("var(--radius-xl)");
    expect(soft.get("--card-shadow")).toBe("var(--card-shadow-soft)");
    expect(minimal.get("--card-radius")).toBe("var(--radius-lg)");
    expect(minimal.get("--card-shadow")).toBe("none");
  });
});
