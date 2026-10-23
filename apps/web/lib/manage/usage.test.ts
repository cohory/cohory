import type { CommunityUsage } from "@cohory/fair-use";
import { describe, expect, it } from "vitest";

import { usageDescription, usageNotes, usageRows, usageTier } from "./usage";

const unlimited: CommunityUsage = {
  tier: "free",
  members: { used: 12, limit: null, state: "ok" },
  storageBytes: { used: 1536, limit: null, state: "ok" },
  uploadBytes: null,
};

const cloud: CommunityUsage = {
  tier: "free",
  members: { used: 1000, limit: 1000, state: "reached" },
  storageBytes: { used: 4 * 1024 ** 3, limit: 5 * 1024 ** 3, state: "near" },
  uploadBytes: 500 * 1024 ** 2,
};

describe("usage card view", () => {
  it("shows used amounts with no limit on an unlimited server", () => {
    expect(usageRows(unlimited)).toEqual([
      { label: "Members", summary: "12, no limit", percent: null, state: "ok" },
      { label: "File storage", summary: "1.5 KB, no limit", percent: null, state: "ok" },
    ]);
    expect(usageDescription(unlimited)).toBe(
      "This server sets no limits on members or file storage.",
    );
    expect(usageNotes(unlimited)).toEqual([]);
  });

  it("shows used versus limit and explains what a reached limit blocks", () => {
    expect(usageRows(cloud)).toEqual([
      { label: "Members", summary: "1,000 of 1,000", percent: 100, state: "reached" },
      { label: "File storage", summary: "4 GB of 5 GB", percent: 80, state: "near" },
    ]);
    expect(usageDescription(cloud)).toBe(
      "Fair use limits for this community. Reaching one pauses new joins or uploads. Nothing already here is hidden or removed.",
    );
    expect(usageNotes(cloud)).toEqual([
      "Largest single upload: 500 MB.",
      "New members can't join until fewer than 1,000 members are active.",
    ]);
  });

  it("explains which limits apply and what raises them", () => {
    expect(usageTier(cloud)).toBe(
      "Free limits apply. Any paid transaction in the last 90 days raises them.",
    );
    expect(usageTier({ ...cloud, tier: "paid" })).toBe(
      "Paid limits apply because this community had a paid transaction in the last 90 days.",
    );
    expect(usageTier(unlimited)).toBeNull();
  });

  it("explains paid limits even when they are unlimited", () => {
    const paid: CommunityUsage = { ...unlimited, tier: "paid" };
    expect(usageDescription(paid)).toBe(
      "No limits on members or file storage apply to this community.",
    );
    expect(usageTier(paid)).toBe(
      "Paid limits apply because this community had a paid transaction in the last 90 days.",
    );
  });
});
