import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanForm, validatePlanForm } from "./plan-form";

const currencies = ["usd", "eur", "jpy"];

describe("validatePlanForm", () => {
  it("converts typed prices into minor units", () => {
    expect(
      validatePlanForm({
        currency: "usd",
        monthlyPrice: "29",
        annualPrice: "290.50",
        annualEnabled: true,
      }),
    ).toEqual({
      ok: true,
      data: { currency: "usd", monthlyPriceMinor: 2900, annualPriceMinor: 29050 },
    });
  });

  it("drops the annual price when it is turned off", () => {
    const result = validatePlanForm({
      currency: "eur",
      monthlyPrice: "9.99",
      annualPrice: "bogus",
      annualEnabled: false,
    });
    expect(result).toEqual({
      ok: true,
      data: { currency: "eur", monthlyPriceMinor: 999, annualPriceMinor: null },
    });
  });

  it("rejects a price below the currency's minimum charge with the server's message", () => {
    expect(
      validatePlanForm({
        currency: "usd",
        monthlyPrice: "0.30",
        annualPrice: "",
        annualEnabled: false,
      }),
    ).toEqual({
      ok: false,
      errors: {
        monthlyPrice: "Set a price of at least 0.50 USD. Stripe does not accept smaller charges.",
      },
    });
  });

  it("rejects missing, zero, malformed, and too large prices", () => {
    expect(
      validatePlanForm({ currency: "usd", monthlyPrice: "", annualPrice: "", annualEnabled: true }),
    ).toEqual({
      ok: false,
      errors: {
        monthlyPrice: "Enter a monthly price, like 29.00.",
        annualPrice: "Enter a yearly price, like 290.00, or remove it.",
      },
    });
    expect(
      validatePlanForm({
        currency: "usd",
        monthlyPrice: "0",
        annualPrice: "",
        annualEnabled: false,
      }),
    ).toEqual({ ok: false, errors: { monthlyPrice: "Enter a price above zero." } });
    expect(
      validatePlanForm({
        currency: "jpy",
        monthlyPrice: "5.5",
        annualPrice: "",
        annualEnabled: false,
      }),
    ).toEqual({ ok: false, errors: { monthlyPrice: "Enter a monthly price, like 29.00." } });
    expect(
      validatePlanForm({
        currency: "usd",
        monthlyPrice: "1000000",
        annualPrice: "",
        annualEnabled: false,
      }),
    ).toEqual({ ok: false, errors: { monthlyPrice: "Enter at most $999,999.99." } });
  });

  it("asks for a currency", () => {
    expect(
      validatePlanForm({ currency: "", monthlyPrice: "5", annualPrice: "", annualEnabled: false }),
    ).toEqual({ ok: false, errors: { currency: "Choose a currency." } });
  });
});

describe("PlanForm", () => {
  it("shows the lowest price Stripe accepts for the chosen currency", () => {
    render(<PlanForm currencies={currencies} onSubmit={vi.fn()} />);

    expect(screen.getByText("At least 0.50 USD.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "jpy" } });
    expect(screen.getByText("At least 50 JPY.")).toBeTruthy();
  });

  it("submits a monthly price in minor units", () => {
    const onSubmit = vi.fn();
    render(<PlanForm currencies={currencies} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "29" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));

    expect(onSubmit).toHaveBeenCalledWith({
      currency: "usd",
      monthlyPriceMinor: 2900,
      annualPriceMinor: null,
    });
  });

  it("keeps the annual price behind a button", () => {
    const onSubmit = vi.fn();
    render(<PlanForm currencies={currencies} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText("Yearly price")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add an annual price" }));
    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Yearly price"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));

    expect(onSubmit).toHaveBeenCalledWith({
      currency: "usd",
      monthlyPriceMinor: 1000,
      annualPriceMinor: 10000,
    });
  });

  it("shows field errors and does not submit invalid prices", () => {
    const onSubmit = vi.fn();
    render(<PlanForm currencies={currencies} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Monthly price");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a monthly price, like 29.00.")).toBeTruthy();
  });

  it("moves focus to the first price that needs fixing", () => {
    render(<PlanForm currencies={currencies} onSubmit={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save pricing" });
    save.focus();

    fireEvent.click(save);

    expect(document.activeElement).toBe(screen.getByLabelText("Monthly price"));
  });

  it("warns before leaving with a changed price", () => {
    render(<PlanForm currencies={currencies} onSubmit={vi.fn()} />);
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "29" } });
    expect(leave()).toBe(true);
  });

  it("fills in the active plan and locks its currency", () => {
    render(
      <PlanForm
        currencies={currencies}
        onSubmit={vi.fn()}
        currencyLocked
        initial={{ currency: "eur", monthlyPriceMinor: 1500, annualPriceMinor: 15000 }}
      />,
    );

    expect((screen.getByLabelText("Monthly price") as HTMLInputElement).value).toBe("15.00");
    expect((screen.getByLabelText("Yearly price") as HTMLInputElement).value).toBe("150.00");
    const currency = screen.getByLabelText("Currency") as HTMLSelectElement;
    expect(currency.value).toBe("eur");
    expect(currency.disabled).toBe(true);
  });

  it("shows a server error", () => {
    render(
      <PlanForm currencies={currencies} onSubmit={vi.fn()} error="Stripe rejected the price." />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Stripe rejected the price.");
  });

  it("shows what the owner keeps from the typed price", () => {
    render(
      <PlanForm
        currencies={currencies}
        onSubmit={vi.fn()}
        platformFeeBps={200}
        providerName="Stripe"
      />,
    );

    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "10" } });

    expect(
      screen.getByText(
        "Member pays $10.00. Platform fee $0.20. Stripe fee varies by card and country. You get the rest.",
      ),
    ).toBeTruthy();
  });

  it("says there is no platform fee when the rate is zero", () => {
    render(
      <PlanForm
        currencies={currencies}
        onSubmit={vi.fn()}
        platformFeeBps={0}
        providerName="Stripe"
        initial={{ currency: "usd", monthlyPriceMinor: 1000, annualPriceMinor: null }}
      />,
    );

    expect(
      screen.getByText(
        "Member pays $10.00. No platform fee. Stripe fee varies by card and country. You get the rest.",
      ),
    ).toBeTruthy();
  });

  it("tells the owner that current members keep their price", () => {
    render(
      <PlanForm
        currencies={currencies}
        onSubmit={vi.fn()}
        initial={{ currency: "usd", monthlyPriceMinor: 1000, annualPriceMinor: null }}
        priceChangeHint
      />,
    );

    expect(
      screen.getByText("New price is for new members. Current members keep what they pay."),
    ).toBeTruthy();
  });

  it("uses the given submit label", () => {
    render(<PlanForm currencies={currencies} onSubmit={vi.fn()} submitLabel="Save draft" />);

    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });
});
