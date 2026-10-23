import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

function block(opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) return "";
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  return "";
}

describe("globals.css", () => {
  it("stops every spinner under reduced motion, outside any layer so it wins", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    expect(reduced).toMatch(/\.animate-spin\s*\{\s*animation:\s*none;/);
  });

  it("balances heading lines so long titles do not leave one word widows", () => {
    expect(block("@layer base")).toMatch(/h4\s*\{[^}]*text-wrap:\s*balance;/);
  });

  it("removes the double tap delay from interactive elements", () => {
    expect(block("@layer base")).toMatch(/\[role="button"\]\s*\{\s*touch-action:\s*manipulation;/);
  });

  it("gives text links a hover color and a focus ring", () => {
    const link = block("@utility text-link");
    expect(link).toMatch(/&:hover\s*\{\s*color:\s*var\(--color-accent-hover\);/);
    expect(link).toMatch(/&:focus-visible\s*\{[^}]*var\(--color-ring\)/);
  });

  it("defines a touch-hit utility that grows the hit area to 44px", () => {
    const utility = block("@utility touch-hit");
    expect(utility).toContain("max(100%, 2.75rem)");
  });
});
