import { describe, expect, it } from "vitest";

import { summarizeUsage, usageItem } from "./usage";

describe("usage summary", () => {
  it("marks usage as near from 80 percent and reached at the limit", () => {
    expect(usageItem(79, 100).state).toBe("ok");
    expect(usageItem(80, 100).state).toBe("near");
    expect(usageItem(100, 100).state).toBe("reached");
    expect(usageItem(120, 100).state).toBe("reached");
  });

  it("reports unlimited resources as ok with no limit", () => {
    expect(usageItem(5_000_000, null)).toEqual({ used: 5_000_000, limit: null, state: "ok" });
  });

  it("combines member and storage counts with the tier limits", () => {
    const summary = summarizeUsage(
      "free",
      { members: 1000, storageBytes: 5000, uploadBytes: 50 },
      { members: 12, storageBytes: 4500 },
    );
    expect(summary).toEqual({
      tier: "free",
      members: { used: 12, limit: 1000, state: "ok" },
      storageBytes: { used: 4500, limit: 5000, state: "near" },
      uploadBytes: 50,
    });
  });
});
