import { describe, expect, it } from "vitest";

import { PaymentsUnavailableError } from "../errors";
import { capabilityRecord, capabilityRecords } from "./capabilities";
import { createProviderRegistry, DuplicateProviderError } from "./registry";
import type { PaymentProvider, ProviderId } from "./types";

function stubProvider(id: ProviderId): PaymentProvider {
  const unused = () => Promise.reject(new Error("not used"));
  return {
    id,
    displayName: id,
    setup: "access_token",
    expectsLiveEvents: () => false,
    capabilities: () => {
      const record = capabilityRecord(id);
      if (!record) throw new Error("no record");
      return record.capabilities;
    },
    verifyWebhook: () => {
      throw new Error("not used");
    },
    normalizeEvent: unused,
    getAccountState: unused,
    provisionPlan: unused,
    retirePrice: unused,
    createCheckout: unused,
    createPortalSession: unused,
    getSubscription: unused,
    cancelSubscription: unused,
    refund: unused,
  };
}

describe("provider registry", () => {
  it("returns the provider registered under an id", () => {
    const connect = stubProvider("stripe_connect");
    const registry = createProviderRegistry([connect, stubProvider("stripe_own_keys")]);
    expect(registry.get("stripe_connect")).toBe(connect);
    expect(registry.ids()).toEqual(["stripe_connect", "stripe_own_keys"]);
  });

  it("reports a missing provider as unavailable instead of guessing", () => {
    const registry = createProviderRegistry([stubProvider("stripe_connect")]);
    expect(registry.find("stripe_own_keys")).toBeNull();
    expect(() => registry.get("stripe_own_keys")).toThrow(PaymentsUnavailableError);
  });

  it("refuses two providers with the same id", () => {
    expect(() =>
      createProviderRegistry([stubProvider("stripe_connect"), stubProvider("stripe_connect")]),
    ).toThrow(DuplicateProviderError);
  });
});

describe("capability records", () => {
  it("has a reviewed record with sources for every provider", () => {
    for (const record of capabilityRecords({ polarEnabled: true })) {
      expect(record.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.sources.every((url) => url.startsWith("https://"))).toBe(true);
    }
  });

  it("only claims a fee split for Stripe Connect", () => {
    const splitting = capabilityRecords({ polarEnabled: true })
      .filter((record) => record.capabilities.supportsFeeSplit)
      .map((record) => record.provider);
    expect(splitting).toEqual(["stripe_connect"]);
  });

  it("lists no Polar capability record when the flag is off", () => {
    const providers = capabilityRecords({ polarEnabled: false }).map((record) => record.provider);
    expect(providers).toEqual(["stripe_connect", "stripe_own_keys"]);
    expect(capabilityRecords({ polarEnabled: true }).map((record) => record.provider)).toContain(
      "polar",
    );
  });
});
