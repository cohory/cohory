import { describe, expect, it } from "vitest";

import { contactPrefill } from "./prefill";

const appUrl = "https://club.example.com";

describe("contact prefill", () => {
  it("fills the topic and the full link from a same origin path", () => {
    expect(contactPrefill({ topic: "billing", from: "/c/painters/classroom?x=1" }, appUrl)).toEqual(
      {
        topic: "Billing",
        link: "https://club.example.com/c/painters/classroom?x=1",
      },
    );
  });

  it("ignores an unknown topic", () => {
    expect(contactPrefill({ topic: "sales" }, appUrl)).toEqual({ topic: null, link: null });
    expect(contactPrefill({ topic: "Billing" }, appUrl).topic).toBeNull();
  });

  it("drops an absolute, protocol relative, or overly long from", () => {
    for (const from of [
      "https://evil.example/c/x",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "c/painters",
      `/${"a".repeat(300)}`,
      "/c/x y",
    ]) {
      expect(contactPrefill({ from }, appUrl).link).toBeNull();
    }
  });

  it("uses the first value when a parameter repeats", () => {
    expect(contactPrefill({ topic: ["help", "billing"] }, appUrl).topic).toBe(
      "Help with my community",
    );
  });
});
