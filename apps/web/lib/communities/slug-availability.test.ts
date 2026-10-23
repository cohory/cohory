import { describe, expect, it, vi } from "vitest";

import { checkSlugAvailability, slugCandidates } from "./slug-availability";

const nothingReserved = () => false;

describe("slugCandidates", () => {
  it("adds short endings to the wanted URL", () => {
    expect(slugCandidates("makers")).toEqual([
      "makers-community",
      "makers-hq",
      "makers-club",
      "makers-online",
      "join-makers",
      "makers-2",
      "makers-3",
    ]);
  });

  it("shortens a long URL so every option stays within 48 characters", () => {
    const long = "a".repeat(40) + "-bcdefgh";

    for (const candidate of slugCandidates(long)) {
      expect(candidate.length).toBeLessThanOrEqual(48);
      expect(candidate).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("checkSlugAvailability", () => {
  it("says a free URL is available without looking for options", async () => {
    const inUse = vi.fn(async () => false);

    const result = await checkSlugAvailability("makers", { isReserved: nothingReserved, inUse });

    expect(result).toEqual({ status: "available" });
    expect(inUse).toHaveBeenCalledTimes(1);
  });

  it("offers three free options when the URL is taken", async () => {
    const taken = new Set(["makers", "makers-community"]);

    const result = await checkSlugAvailability("makers", {
      isReserved: nothingReserved,
      inUse: async (slug) => taken.has(slug),
    });

    expect(result).toEqual({
      status: "taken",
      suggestions: ["makers-hq", "makers-club", "makers-online"],
    });
  });

  it("reports a reserved URL and skips reserved options", async () => {
    const result = await checkSlugAvailability("help", {
      isReserved: (slug) => slug === "help" || slug === "help-hq",
      inUse: async () => false,
    });

    expect(result).toEqual({
      status: "reserved",
      suggestions: ["help-community", "help-club", "help-online"],
    });
  });
});
