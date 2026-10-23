import { describe, expect, it } from "vitest";

import {
  ApiBaseUrlRefusedError,
  assertTestModeKey,
  LiveKeyRefusedError,
  parsePaymentsEnv,
} from "./config";
import { keyIdOf } from "./crypto";

const key = Buffer.alloc(32, 7).toString("base64");

describe("parsePaymentsEnv", () => {
  it("defaults to the Community Edition with the 200 bps Cloud rate configured", () => {
    const env = parsePaymentsEnv({});
    expect(env.edition).toBe("community");
    expect(env.platformFeeBps).toBe(200);
    expect(env.stripeSecretKey).toBeNull();
    expect(env.webhookSecrets).toEqual([]);
  });

  it("defaults the Cloud platform fee to 200 basis points", () => {
    expect(parsePaymentsEnv({ COHORY_EDITION: "cloud" }).platformFeeBps).toBe(200);
  });

  it("offers linking existing subscriptions only on the Community Edition", () => {
    expect(parsePaymentsEnv({}).subscriptionLinking).toBe(true);
    expect(parsePaymentsEnv({ COHORY_EDITION: "cloud" }).subscriptionLinking).toBe(false);
  });

  it("keeps Polar off unless COHORY_ENABLE_POLAR is true", () => {
    expect(parsePaymentsEnv({}).polarEnabled).toBe(false);
    expect(parsePaymentsEnv({ COHORY_ENABLE_POLAR: "" }).polarEnabled).toBe(false);
    expect(parsePaymentsEnv({ COHORY_ENABLE_POLAR: "false" }).polarEnabled).toBe(false);
    expect(parsePaymentsEnv({ COHORY_ENABLE_POLAR: "true" }).polarEnabled).toBe(true);
    expect(() => parsePaymentsEnv({ COHORY_ENABLE_POLAR: "yes" })).toThrow();
  });

  it("reads the Cloud settings", () => {
    const env = parsePaymentsEnv({
      COHORY_EDITION: "cloud",
      PLATFORM_FEE_BPS: "150",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_a",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_b",
      PAYMENTS_ENCRYPTION_KEY: key,
      APP_URL: "http://localhost:3000/",
    });
    expect(env.edition).toBe("cloud");
    expect(env.platformFeeBps).toBe(150);
    expect(env.stripeSecretKey).toBe("sk_test_123");
    expect(env.webhookSecrets).toEqual(["whsec_a", "whsec_b"]);
    expect(env.encryptionKeys?.keys.size).toBe(1);
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("reads the platform's Connect client id only in its ca_ form", () => {
    expect(parsePaymentsEnv({}).connectClientId).toBeNull();
    expect(parsePaymentsEnv({ STRIPE_CONNECT_CLIENT_ID: "" }).connectClientId).toBeNull();
    expect(parsePaymentsEnv({ STRIPE_CONNECT_CLIENT_ID: "ca_abc123" }).connectClientId).toBe(
      "ca_abc123",
    );
    expect(() => parsePaymentsEnv({ STRIPE_CONNECT_CLIENT_ID: "acct_abc" })).toThrow();
  });

  it("reads an API base URL override for test doubles and leaves it unset by default", () => {
    expect(parsePaymentsEnv({}).stripeApiBaseUrl).toBeNull();
    expect(parsePaymentsEnv({ STRIPE_API_BASE_URL: "" }).stripeApiBaseUrl).toBeNull();
    expect(
      parsePaymentsEnv({ STRIPE_API_BASE_URL: "http://stripe-mock:12111" }).stripeApiBaseUrl,
    ).toBe("http://stripe-mock:12111");
    expect(() => parsePaymentsEnv({ STRIPE_API_BASE_URL: "stripe-mock" })).toThrow();
  });

  it("refuses an API base URL override next to a live key so the key never goes to another host", () => {
    expect(() =>
      parsePaymentsEnv({
        NODE_ENV: "production",
        STRIPE_SECRET_KEY: "sk_live_abc",
        STRIPE_API_BASE_URL: "http://stripe-mock:12111",
      }),
    ).toThrow(ApiBaseUrlRefusedError);
    expect(
      parsePaymentsEnv({
        NODE_ENV: "production",
        STRIPE_SECRET_KEY: "sk_live_abc",
      }).stripeApiBaseUrl,
    ).toBeNull();
  });

  it("keeps the override for a production build that runs against a test double with a test key", () => {
    expect(
      parsePaymentsEnv({
        NODE_ENV: "production",
        STRIPE_SECRET_KEY: "sk_test_e2e",
        STRIPE_API_BASE_URL: "http://fake-stripe:12111",
      }).stripeApiBaseUrl,
    ).toBe("http://fake-stripe:12111");
  });

  it("reads a Polar API base URL override for the fixture server", () => {
    expect(parsePaymentsEnv({}).polarApiBaseUrl).toBeNull();
    expect(
      parsePaymentsEnv({ POLAR_API_BASE_URL: "http://fake-polar:12112" }).polarApiBaseUrl,
    ).toBe("http://fake-polar:12112");
    expect(() => parsePaymentsEnv({ POLAR_API_BASE_URL: "fake-polar" })).toThrow();
  });

  it("encrypts with the first of PAYMENTS_ENCRYPTION_KEYS and keeps the others for reading", () => {
    const next = Buffer.alloc(32, 8).toString("base64");
    const env = parsePaymentsEnv({
      PAYMENTS_ENCRYPTION_KEYS: `${next}, ${key}`,
      PAYMENTS_ENCRYPTION_KEY: key,
    });
    expect(env.encryptionKeys?.currentId).toBe(keyIdOf(Buffer.alloc(32, 8)));
    expect(env.encryptionKeys?.keys.size).toBe(2);
  });

  it("keeps PAYMENTS_ENCRYPTION_KEY as the current key when no list is set", () => {
    const env = parsePaymentsEnv({ PAYMENTS_ENCRYPTION_KEY: key });
    expect(env.encryptionKeys?.currentId).toBe(keyIdOf(Buffer.from(key, "base64")));
  });

  it("rejects a key list with a key that is not 32 bytes", () => {
    expect(() =>
      parsePaymentsEnv({
        PAYMENTS_ENCRYPTION_KEYS: `${key},${Buffer.alloc(8).toString("base64")}`,
      }),
    ).toThrow();
  });

  it("treats empty strings as unset", () => {
    const env = parsePaymentsEnv({
      STRIPE_SECRET_KEY: "",
      PAYMENTS_ENCRYPTION_KEY: "",
      PLATFORM_FEE_BPS: "",
    });
    expect(env.stripeSecretKey).toBeNull();
    expect(env.encryptionKeys).toBeNull();
    expect(env.platformFeeBps).toBe(200);
  });

  it.each(["-1", "10001", "1.5", "abc"])("rejects a fee rate of %s", (value) => {
    expect(() => parsePaymentsEnv({ PLATFORM_FEE_BPS: value })).toThrow();
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      parsePaymentsEnv({ PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
  });

  it("refuses live keys outside production", () => {
    expect(() =>
      parsePaymentsEnv({ STRIPE_SECRET_KEY: "sk_live_123", NODE_ENV: "development" }),
    ).toThrow(LiveKeyRefusedError);
    expect(() => parsePaymentsEnv({ STRIPE_SECRET_KEY: "rk_live_123" })).toThrow(
      LiveKeyRefusedError,
    );
  });

  it("allows live keys in production", () => {
    expect(
      parsePaymentsEnv({ STRIPE_SECRET_KEY: "sk_live_123", NODE_ENV: "production" })
        .stripeSecretKey,
    ).toBe("sk_live_123");
  });
});

describe("assertTestModeKey", () => {
  it("accepts test keys everywhere", () => {
    expect(() => assertTestModeKey("sk_test_1", "development")).not.toThrow();
    expect(() => assertTestModeKey("rk_test_1", undefined)).not.toThrow();
  });

  it("rejects live keys unless NODE_ENV is production", () => {
    expect(() => assertTestModeKey("sk_live_1", "test")).toThrow(LiveKeyRefusedError);
    expect(() => assertTestModeKey("sk_live_1", "production")).not.toThrow();
  });
});

describe("app url", () => {
  it("prefers APP_URL, falls back to BETTER_AUTH_URL, and ignores the build time variable", () => {
    expect(
      parsePaymentsEnv({ APP_URL: "https://app.example/", BETTER_AUTH_URL: "https://auth.example" })
        .appUrl,
    ).toBe("https://app.example");
    expect(parsePaymentsEnv({ BETTER_AUTH_URL: "https://auth.example/" }).appUrl).toBe(
      "https://auth.example",
    );
    expect(parsePaymentsEnv({ NEXT_PUBLIC_APP_URL: "https://built.example" }).appUrl).toBeNull();
  });
});
