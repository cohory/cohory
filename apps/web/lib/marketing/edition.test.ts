import { describe, expect, it } from "vitest";

import { hasMarketingPages, marketingPaths } from "./edition";

describe("hasMarketingPages", () => {
  it("shows the marketing pages on the Cloud Edition", () => {
    expect(hasMarketingPages("cloud")).toBe(true);
  });

  it("hides them on the Community Edition", () => {
    expect(hasMarketingPages("community")).toBe(false);
  });
});

describe("marketingPaths", () => {
  it("lists pricing and open source", () => {
    expect(marketingPaths).toEqual(["/pricing", "/open-source"]);
  });
});
