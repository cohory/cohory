import { describe, expect, it, vi } from "vitest";

import { parseFairUseEnv } from "./config";
import {
  paidTierWindowDays,
  paidTierWindowStart,
  resolveLimits,
  tierFromPaidActivity,
} from "./tier";

describe("paid tier window", () => {
  it("looks back 90 days from now", () => {
    expect(paidTierWindowDays).toBe(90);
    expect(paidTierWindowStart(new Date("2026-10-19T12:00:00Z")).toISOString()).toBe(
      "2026-07-21T12:00:00.000Z",
    );
  });

  it("is paid only when there was a paid transaction in the window", () => {
    expect(tierFromPaidActivity(true)).toBe("paid");
    expect(tierFromPaidActivity(false)).toBe("free");
  });
});

describe("resolveLimits", () => {
  it("does not look up the tier when both tiers share the limits asked for", async () => {
    const tierOf = vi.fn();
    const config = parseFairUseEnv({ FAIR_USE_MEMBERS: "500" });
    await expect(resolveLimits(config, ["members"], tierOf)).resolves.toBe(config.free);
    expect(tierOf).not.toHaveBeenCalled();
  });

  it("uses the paid limits for a community with recent paid transactions", async () => {
    const config = parseFairUseEnv({ COHORY_EDITION: "cloud" });
    await expect(resolveLimits(config, ["members"], async () => "paid")).resolves.toBe(config.paid);
    await expect(resolveLimits(config, ["members"], async () => "free")).resolves.toBe(config.free);
  });
});
