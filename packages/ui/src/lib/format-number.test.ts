import { describe, expect, it } from "vitest";

import { formatCount } from "./format-number";

describe("formatCount", () => {
  it("groups thousands with a comma whatever the runtime locale is", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("prints small counts unchanged", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(42)).toBe("42");
  });
});
