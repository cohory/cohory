import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BillingInterval } from "./money";
import { PricingCard, type PricingCardProps } from "./pricing-card";

const plan = {
  name: "Membership",
  currency: "usd",
  monthlyPriceMinor: 2900,
  annualPriceMinor: 29000,
};

function Harness(props: Partial<PricingCardProps>) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  return (
    <PricingCard
      plan={plan}
      interval={interval}
      onIntervalChange={setInterval}
      onBuy={vi.fn()}
      {...props}
    />
  );
}

describe("PricingCard", () => {
  it("shows the monthly price and a buy button that names it", () => {
    const onBuy = vi.fn();
    render(<Harness onBuy={onBuy} />);

    expect(screen.getByText("$29.00")).toBeTruthy();
    expect(screen.getByText("29.00 US dollars per month")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join for $29.00/month" }));
    expect(onBuy).toHaveBeenCalledWith("month");
  });

  it("switches to the annual price when the yearly option is chosen", () => {
    const onBuy = vi.fn();
    render(<Harness onBuy={onBuy} />);

    fireEvent.click(screen.getByRole("radio", { name: "Yearly" }));

    expect(screen.getByText("$290.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join for $290.00/year" }));
    expect(onBuy).toHaveBeenCalledWith("year");
  });

  it("states the exact yearly saving once the yearly price is chosen", () => {
    render(<Harness plan={{ ...plan, monthlyPriceMinor: 1000, annualPriceMinor: 10000 }} />);

    expect(screen.queryByText(/^Save/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Yearly" }));

    expect(screen.getByText("Save $20.00 a year")).toBeTruthy();
  });

  it("claims no saving when yearly costs as much as twelve months", () => {
    render(<Harness plan={{ ...plan, monthlyPriceMinor: 1000, annualPriceMinor: 12000 }} />);

    fireEvent.click(screen.getByRole("radio", { name: "Yearly" }));

    expect(screen.queryByText(/^Save/)).toBeNull();
  });

  it("hides the interval choice when there is no annual price", () => {
    render(<Harness plan={{ ...plan, annualPriceMinor: null }} />);

    expect(screen.queryByRole("radio", { name: "Yearly" })).toBeNull();
  });

  it("hides the buy button for a free community", () => {
    render(<Harness plan={null} />);

    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join for/ })).toBeNull();
  });

  it("marks the current plan and offers no second purchase", () => {
    render(<Harness state="current" />);

    expect(screen.getByText("Your plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join for/ })).toBeNull();
  });

  it("asks a past due member to update the payment method", () => {
    const onManageBilling = vi.fn();
    render(<Harness state="past_due" onManageBilling={onManageBilling} />);

    expect(screen.getByText(/Your last payment failed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Join for/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    expect(onManageBilling).toHaveBeenCalled();
  });

  it("explains why buying is not available", () => {
    render(<Harness state="disabled" disabledReason="Memberships aren't for sale right now." />);

    expect(screen.getByRole("button", { name: "Not available" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText("Memberships aren't for sale right now.")).toBeTruthy();
  });

  it("disables the button while checkout starts", () => {
    render(<Harness pending />);

    const button = screen.getByRole("button", { name: "Opening checkout" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
