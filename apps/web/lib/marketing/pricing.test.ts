import { parseFairUseEnv } from "@cohory/fair-use";
import { describe, expect, it } from "vitest";

import { cloudPricing, loadCloudPricing } from "./pricing";

const cloudLimits = parseFairUseEnv({ COHORY_EDITION: "cloud" });

describe("cloudPricing", () => {
  it("states the platform fee from the configured basis points", () => {
    const pricing = cloudPricing({ platformFeeBps: 150, fairUse: cloudLimits });

    expect(pricing.feeRate).toBe("1.5%");
    expect(pricing.feeLine).toBe(
      "Platform fee: 1.5% of each successful payment. Stripe processing fees are separate.",
    );
    expect(pricing.summary).toBe(
      "Free to start. 1.5% of each payment you receive. Stripe processing fees are separate.",
    );
  });

  it("says there is no platform fee when the rate is zero", () => {
    const pricing = cloudPricing({ platformFeeBps: 0, fairUse: cloudLimits });

    expect(pricing.feeRate).toBeNull();
    expect(pricing.summary).toBe(
      "Free to start. No platform fee. Stripe processing fees are separate.",
    );
  });

  it("compares with the Community Edition, which charges no platform fee", () => {
    expect(cloudPricing({ platformFeeBps: 200, fairUse: cloudLimits }).selfHostedFeeLine).toBe(
      "No platform fee. Stripe processing fees are separate.",
    );
  });

  it("lists the fair use limits of both tiers from the config", () => {
    const fairUse = parseFairUseEnv({
      COHORY_EDITION: "cloud",
      FAIR_USE_MEMBERS: "250",
      FAIR_USE_PAID_STORAGE_BYTES: "unlimited",
    });

    expect(cloudPricing({ platformFeeBps: 200, fairUse }).limits).toEqual([
      { label: "Members", free: "250 members", paid: "No limit" },
      { label: "File storage", free: "5 GB", paid: "No limit" },
      { label: "Largest upload", free: "500 MB", paid: "2 GB" },
    ]);
  });

  it("counts a community as paid after a payment in the last 90 days", () => {
    expect(cloudPricing({ platformFeeBps: 200, fairUse: cloudLimits }).paidWindowDays).toBe(90);
  });
});

describe("loadCloudPricing", () => {
  it("reads the fee rate from PLATFORM_FEE_BPS through the payments config", () => {
    expect(loadCloudPricing({ COHORY_EDITION: "cloud", PLATFORM_FEE_BPS: "300" }).feeRate).toBe(
      "3%",
    );
  });

  it("falls back to the payments default rate when PLATFORM_FEE_BPS is unset", () => {
    expect(loadCloudPricing({ COHORY_EDITION: "cloud" }).feeRate).toBe("2%");
  });

  it("reads the limits from the FAIR_USE variables", () => {
    const pricing = loadCloudPricing({ COHORY_EDITION: "cloud", FAIR_USE_MEMBERS: "40" });

    expect(pricing.limits[0]).toEqual({ label: "Members", free: "40 members", paid: "No limit" });
  });
});
