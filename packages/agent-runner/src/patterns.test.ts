import { describe, expect, it } from "vitest";

import { maxPatternLength, unsafePatternReason, unsafePatterns } from "./patterns";

describe("unsafePatternReason", () => {
  it.each(["(a+)+$", "(a*)*b", "(a|aa)+", "^(\\w+\\s?)*$", "(x{1,5}){2,}", "(.*a){3,}"])(
    "refuses %s, which can backtrack for a very long time",
    (pattern) => {
      expect(unsafePatternReason(pattern)).not.toBeNull();
    },
  );

  it("refuses back references and very long patterns", () => {
    expect(unsafePatternReason("(a)\\1")).toBe("uses a back reference");
    expect(unsafePatternReason("a".repeat(maxPatternLength + 1))).toContain("longer than");
  });

  it.each([
    "^[a-z0-9-]+$",
    "^\\d{4}-\\d{2}-\\d{2}$",
    "^(foo|bar)$",
    "^(ab)+$",
    "^[(]+$",
    "^v\\(\\d+\\)$",
  ])("accepts %s", (pattern) => {
    expect(unsafePatternReason(pattern)).toBeNull();
  });
});

describe("unsafePatterns", () => {
  it("finds patterns and pattern property names anywhere in a schema", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", pattern: "(a+)+$" } },
      patternProperties: { "^(x|xx)+$": { type: "string" } },
      items: [{ pattern: "^ok$" }],
    };
    expect(unsafePatterns(schema)).toHaveLength(2);
  });
});
