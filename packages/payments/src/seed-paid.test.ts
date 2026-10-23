import { describe, expect, it } from "vitest";

import { PaidSeedRefusedError, paidSeedAccountId, paidSeedSecretKey } from "./seed-paid";

describe("paidSeedAccountId", () => {
  it("refuses to run when PAID_SEED_ACCOUNT_ID is not set", () => {
    expect(() => paidSeedAccountId({})).toThrow(/set PAID_SEED_ACCOUNT_ID/);
    expect(() => paidSeedAccountId({ PAID_SEED_ACCOUNT_ID: "" })).toThrow(
      /set PAID_SEED_ACCOUNT_ID/,
    );
  });

  it("uses the connected account named in PAID_SEED_ACCOUNT_ID", () => {
    expect(paidSeedAccountId({ PAID_SEED_ACCOUNT_ID: "acct_e2eabc123" })).toBe("acct_e2eabc123");
  });

  it.each(["acct_", "cus_123", "acct_12 3", "acct_1/../x"])("refuses the account id %s", (id) => {
    expect(() => paidSeedAccountId({ PAID_SEED_ACCOUNT_ID: id })).toThrow(PaidSeedRefusedError);
  });
});

describe("paidSeedSecretKey", () => {
  it("returns a sandbox secret key", () => {
    expect(paidSeedSecretKey({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe("sk_test_abc");
  });

  it("refuses to run when NODE_ENV is production, even with a sandbox key", () => {
    expect(() =>
      paidSeedSecretKey({ NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_test_abc" }),
    ).toThrow(PaidSeedRefusedError);
  });

  it.each(["sk_live_abc", "rk_test_abc", "rk_live_abc", "", undefined])(
    "refuses the key %s",
    (key) => {
      expect(() => paidSeedSecretKey({ STRIPE_SECRET_KEY: key })).toThrow(
        /needs a Stripe sandbox secret key/,
      );
    },
  );
});
