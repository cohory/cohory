import { describe, expect, it } from "vitest";

import { joinIntentLine, planPrice, type JoinIntentContext } from "./join-copy";

const base: JoinIntentContext = {
  name: "Cohory Pro",
  intent: "join",
  price: null,
  provider: null,
};

describe("joinIntentLine", () => {
  it("names the community the person is about to join", () => {
    expect(joinIntentLine(base, "sign_up")).toBe("Create your account to join Cohory Pro.");
    expect(joinIntentLine(base, "sign_in")).toBe("Sign in to join Cohory Pro.");
  });

  it("says a request is sent next when the community approves members", () => {
    expect(joinIntentLine({ ...base, intent: "request" }, "sign_up")).toBe(
      "Create your account, then ask to join Cohory Pro.",
    );
  });

  it("states the price and the payment step before the person commits to a paid join", () => {
    const paid = {
      ...base,
      intent: "checkout",
      price: "$10.00/month",
      provider: "Stripe",
    } as const;
    expect(joinIntentLine(paid, "sign_up")).toBe(
      "Create your account, then pay $10.00/month with Stripe to join Cohory Pro. Cancel anytime.",
    );
    expect(joinIntentLine(paid, "sign_in")).toBe(
      "Sign in, then pay $10.00/month with Stripe to join Cohory Pro. Cancel anytime.",
    );
  });

  it("leaves out the provider when the plan does not name one", () => {
    expect(joinIntentLine({ ...base, intent: "checkout", price: "$96.00/year" }, "sign_up")).toBe(
      "Create your account, then pay $96.00/year to join Cohory Pro. Cancel anytime.",
    );
  });

  it("falls back to the plain join line when a paid join has no plan on sale", () => {
    expect(joinIntentLine({ ...base, intent: "checkout" }, "sign_up")).toBe(
      "Create your account to join Cohory Pro.",
    );
  });
});

describe("planPrice", () => {
  const plan = { monthlyPriceMinor: 1000, annualPriceMinor: 9600, currency: "usd" };

  it("shows the monthly price for a monthly checkout", () => {
    expect(planPrice(plan, "checkout")).toBe("$10.00/month");
  });

  it("shows the yearly price for a yearly checkout", () => {
    expect(planPrice(plan, "checkout_yearly")).toBe("$96.00/year");
  });

  it("falls back to the monthly price when the plan has no yearly price", () => {
    expect(planPrice({ ...plan, annualPriceMinor: null }, "checkout_yearly")).toBe("$10.00/month");
  });
});
