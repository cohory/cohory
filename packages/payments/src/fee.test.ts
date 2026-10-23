import { describe, expect, it } from "vitest";

import {
  allocateFeeRefunds,
  applicationFeePercent,
  computeApplicationFee,
  cumulativeFeeRefundDue,
  disputeFeeRefundDue,
  effectiveFeeBps,
  feeBpsFromPercent,
  InvalidFeeInputError,
} from "./fee";

describe("computeApplicationFee", () => {
  it.each([
    [0, 100, 0],
    [1, 100, 0],
    [49, 100, 0],
    [50, 100, 1],
    [51, 100, 1],
    [99, 100, 1],
    [100, 100, 1],
    [101, 100, 1],
    [149, 100, 1],
    [150, 100, 2],
    [999, 100, 10],
    [4900, 100, 49],
    [10_000, 100, 100],
    [12_345, 100, 123],
    [12_345, 250, 309],
    [2 ** 31, 100, 21_474_836],
    [2 ** 31 - 1, 100, 21_474_836],
    [2 ** 31 + 50, 100, 21_474_837],
    [1, 10_000, 1],
    [500, 1, 0],
    [5_000, 1, 1],
  ])("charges %i at %i bps a fee of %i", (amount, bps, fee) => {
    expect(computeApplicationFee(amount, bps)).toBe(fee);
  });

  it("rounds half up with integer math on large amounts", () => {
    expect(computeApplicationFee(Number.MAX_SAFE_INTEGER, 100)).toBe(90_071_992_547_410);
    expect(computeApplicationFee(9_999_999_950, 100)).toBe(100_000_000);
  });

  it("charges nothing when the rate is zero", () => {
    for (const amount of [0, 1, 99, 100, 101, 999, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(computeApplicationFee(amount, 0)).toBe(0);
    }
  });

  it("never exceeds the amount, never goes negative, and grows with the amount", () => {
    for (const bps of [0, 1, 50, 100, 250, 999, 5_000, 10_000]) {
      let previous = 0;
      for (let amount = 0; amount <= 5_000; amount += 7) {
        const fee = computeApplicationFee(amount, bps);
        expect(fee).toBeGreaterThanOrEqual(0);
        expect(fee).toBeLessThanOrEqual(amount);
        expect(fee).toBeGreaterThanOrEqual(previous);
        expect(Number.isInteger(fee)).toBe(true);
        previous = fee;
      }
    }
  });

  it.each([
    [-1, 100],
    [1.5, 100],
    [Number.NaN, 100],
    [Number.MAX_SAFE_INTEGER + 1, 100],
    [100, -1],
    [100, 10_001],
    [100, 0.5],
  ])("rejects amount %s at %s bps", (amount, bps) => {
    expect(() => computeApplicationFee(amount, bps)).toThrow(InvalidFeeInputError);
  });
});

describe("cumulativeFeeRefundDue", () => {
  it("refunds the whole fee on a full refund", () => {
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 4900,
        feeRefundedMinor: 0,
      }),
    ).toBe(49);
  });

  it("refunds the platform fee proportionally on a partial refund", () => {
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 2450,
        feeRefundedMinor: 0,
      }),
    ).toBe(25);
  });

  it("subtracts what was already refunded across multiple partial refunds", () => {
    const first = cumulativeFeeRefundDue({
      feeMinor: 49,
      chargedMinor: 4900,
      refundedMinor: 1000,
      feeRefundedMinor: 0,
    });
    const second = cumulativeFeeRefundDue({
      feeMinor: 49,
      chargedMinor: 4900,
      refundedMinor: 4900,
      feeRefundedMinor: first,
    });
    expect(first).toBe(10);
    expect(first + second).toBe(49);
  });

  it("never refunds more than the fee or a negative amount", () => {
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 4900,
        feeRefundedMinor: 49,
      }),
    ).toBe(0);
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 100,
        feeRefundedMinor: 49,
      }),
    ).toBe(0);
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 0,
        chargedMinor: 0,
        refundedMinor: 0,
        feeRefundedMinor: 0,
      }),
    ).toBe(0);
  });

  it("rounds a half fee unit up on a partial refund", () => {
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 50,
        feeRefundedMinor: 0,
      }),
    ).toBe(1);
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 1,
        chargedMinor: 100,
        refundedMinor: 49,
        feeRefundedMinor: 0,
      }),
    ).toBe(0);
    expect(
      cumulativeFeeRefundDue({
        feeMinor: 1,
        chargedMinor: 100,
        refundedMinor: 50,
        feeRefundedMinor: 0,
      }),
    ).toBe(1);
  });

  it("never refunds more than the fee in total across any sequence of partial refunds", () => {
    for (const charged of [1, 99, 100, 101, 4900, 12_345]) {
      const fee = computeApplicationFee(charged, 100);
      for (const step of [1, 7, 50, 333]) {
        let refunded = 0;
        let feeRefunded = 0;
        while (refunded < charged) {
          refunded = Math.min(charged, refunded + step);
          const due = cumulativeFeeRefundDue({
            feeMinor: fee,
            chargedMinor: charged,
            refundedMinor: refunded,
            feeRefundedMinor: feeRefunded,
          });
          expect(due).toBeGreaterThanOrEqual(0);
          feeRefunded += due;
          expect(feeRefunded).toBeLessThanOrEqual(fee);
        }
        expect(feeRefunded).toBe(fee);
      }
    }
  });

  it("rejects a refund larger than the charge", () => {
    expect(() =>
      cumulativeFeeRefundDue({
        feeMinor: 49,
        chargedMinor: 4900,
        refundedMinor: 4901,
        feeRefundedMinor: 0,
      }),
    ).toThrow(InvalidFeeInputError);
  });
});

describe("disputeFeeRefundDue", () => {
  it("refunds the whole fee when the full charge is lost in a dispute", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 0,
        disputedMinor: 4900,
        feeRefundedMinor: 0,
      }),
    ).toBe(98);
  });

  it("refunds the fee on the disputed part only when a partial dispute is lost", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 0,
        disputedMinor: 1225,
        feeRefundedMinor: 0,
      }),
    ).toBe(25);
  });

  it("refunds nothing for a zero amount dispute or a zero fee", () => {
    const base = { chargedMinor: 4900, refundedMinor: 0, feeRefundedMinor: 0 };
    expect(disputeFeeRefundDue({ ...base, feeMinor: 98, disputedMinor: 0 })).toBe(0);
    expect(disputeFeeRefundDue({ ...base, feeMinor: 0, disputedMinor: 4900 })).toBe(0);
    expect(
      disputeFeeRefundDue({
        feeMinor: 0,
        chargedMinor: 0,
        refundedMinor: 0,
        disputedMinor: 0,
        feeRefundedMinor: 0,
      }),
    ).toBe(0);
  });

  it("refunds only the rest of the fee when part of the charge was refunded before the dispute", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 2450,
        disputedMinor: 2450,
        feeRefundedMinor: 49,
      }),
    ).toBe(49);
  });

  it("refunds nothing more when the dispute refund was already made", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 0,
        disputedMinor: 1225,
        feeRefundedMinor: 25,
      }),
    ).toBe(0);
  });

  it("never refunds more than the fee when refunds and the dispute exceed the charge", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 2450,
        disputedMinor: 4900,
        feeRefundedMinor: 49,
      }),
    ).toBe(49);
  });

  it("rounds the dispute share half up", () => {
    expect(
      disputeFeeRefundDue({
        feeMinor: 1,
        chargedMinor: 2,
        refundedMinor: 0,
        disputedMinor: 1,
        feeRefundedMinor: 0,
      }),
    ).toBe(1);
  });

  it("rejects a disputed amount larger than the charge", () => {
    expect(() =>
      disputeFeeRefundDue({
        feeMinor: 98,
        chargedMinor: 4900,
        refundedMinor: 0,
        disputedMinor: 4901,
        feeRefundedMinor: 0,
      }),
    ).toThrow(InvalidFeeInputError);
  });
});

describe("currency minor units", () => {
  const majorToMinor = (major: number, exponent: number) => major * 10 ** exponent;

  it.each([
    ["JPY", 0, 4900, 98],
    ["USD", 2, 490_000, 9800],
    ["KWD", 3, 4_900_000, 98_000],
  ])("computes a 2%% fee on 4900 %s in its own minor units", (_code, exponent, amount, fee) => {
    expect(majorToMinor(4900, exponent)).toBe(amount);
    expect(computeApplicationFee(amount, 200)).toBe(fee);
  });

  it.each([
    ["JPY", 0, 1, 0],
    ["JPY", 0, 25, 1],
    ["USD", 2, 25, 1],
    ["KWD", 3, 1_025, 21],
  ])("rounds the fee half up to a whole %s minor unit", (_code, _exponent, amount, fee) => {
    expect(computeApplicationFee(amount, 200)).toBe(fee);
  });

  it.each([
    ["JPY", 0],
    ["USD", 2],
    ["KWD", 3],
  ])("refunds the fee on a lost partial %s dispute in minor units", (_code, exponent) => {
    const charged = majorToMinor(50, exponent);
    const fee = computeApplicationFee(charged, 200);
    const due = disputeFeeRefundDue({
      feeMinor: fee,
      chargedMinor: charged,
      refundedMinor: 0,
      disputedMinor: majorToMinor(50, exponent) / 2,
      feeRefundedMinor: 0,
    });
    expect(Number.isInteger(due)).toBe(true);
    expect(due).toBe(Math.floor((fee + 1) / 2));
  });
});

describe("effectiveFeeBps", () => {
  it("uses the configured rate on Cloud with Stripe Connect", () => {
    expect(
      effectiveFeeBps({ edition: "cloud", provider: "stripe_connect", configuredBps: 100 }),
    ).toBe(100);
    expect(
      effectiveFeeBps({ edition: "cloud", provider: "stripe_connect", configuredBps: 250 }),
    ).toBe(250);
  });

  it("is zero on the Community Edition whatever the configuration says", () => {
    expect(
      effectiveFeeBps({ edition: "community", provider: "stripe_connect", configuredBps: 100 }),
    ).toBe(0);
    expect(
      effectiveFeeBps({ edition: "community", provider: "stripe_own_keys", configuredBps: 100 }),
    ).toBe(0);
  });

  it("is zero for the creator's own keys even on Cloud", () => {
    expect(
      effectiveFeeBps({ edition: "cloud", provider: "stripe_own_keys", configuredBps: 100 }),
    ).toBe(0);
  });

  it("accrues the configured rate for a provider without a fee split on Cloud", () => {
    expect(effectiveFeeBps({ edition: "cloud", provider: "polar", configuredBps: 100 })).toBe(100);
    expect(effectiveFeeBps({ edition: "community", provider: "polar", configuredBps: 100 })).toBe(
      0,
    );
  });
});

describe("applicationFeePercent", () => {
  it.each([
    [100, 1],
    [1, 0.01],
    [250, 2.5],
    [0, 0],
    [10_000, 100],
  ])("turns %i bps into %s percent", (bps, percent) => {
    expect(applicationFeePercent(bps)).toBe(percent);
  });
});

describe("feeBpsFromPercent", () => {
  it.each([
    [1, 100],
    [0.01, 1],
    [2.5, 250],
    [0.07, 7],
    [0.29, 29],
    [100, 10_000],
    [0, 0],
  ])("turns %s percent into %i bps", (percent, bps) => {
    expect(feeBpsFromPercent(percent)).toBe(bps);
  });

  it("reads a missing percent as no fee", () => {
    expect(feeBpsFromPercent(null)).toBe(0);
  });

  it("round trips every whole bps rate through applicationFeePercent", () => {
    for (let bps = 0; bps <= 10_000; bps += 1) {
      expect(feeBpsFromPercent(applicationFeePercent(bps))).toBe(bps);
    }
  });

  it.each([-1, 100.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s percent", (percent) => {
    expect(() => feeBpsFromPercent(percent)).toThrow(InvalidFeeInputError);
  });
});

describe("allocateFeeRefunds", () => {
  const fee = { currency: "usd", amountRefunded: 290 };

  it("uses the refund amounts as they are when they share the fee currency", () => {
    const shares = allocateFeeRefunds(
      [
        { id: "fr_1", amount: 100, currency: "usd" },
        { id: "fr_2", amount: 190, currency: "usd" },
      ],
      fee,
    );
    expect([...shares]).toEqual([
      ["fr_1", 100],
      ["fr_2", 190],
    ]);
  });

  it("maps a single settlement currency refund to the fee's refunded amount", () => {
    const shares = allocateFeeRefunds([{ id: "fr_1", amount: 218, currency: "gbp" }], fee);
    expect(shares.get("fr_1")).toBe(290);
  });

  it("splits the refunded fee across settlement currency refunds without losing a minor unit", () => {
    const shares = allocateFeeRefunds(
      [
        { id: "fr_1", amount: 73, currency: "gbp" },
        { id: "fr_2", amount: 73, currency: "gbp" },
        { id: "fr_3", amount: 72, currency: "gbp" },
      ],
      { currency: "usd", amountRefunded: 290 },
    );
    const values = [...shares.values()];
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(290);
    expect(values).toEqual([97, 97, 96]);
  });

  it("gives every refund zero when nothing was refunded", () => {
    const shares = allocateFeeRefunds([{ id: "fr_1", amount: 0, currency: "gbp" }], {
      currency: "usd",
      amountRefunded: 0,
    });
    expect(shares.get("fr_1")).toBe(0);
  });
});
