import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlatformBillingSettings } from "./platform-billing-settings";

import {
  PlatformFeeBalances,
  PlatformInvoiceTable,
  type PlatformInvoiceRow,
} from "./platform-fees";

const nextInvoiceAt = new Date("2026-12-01T00:00:00Z");

describe("PlatformFeeBalances", () => {
  it("explains that Stripe Connect fees are collected at charge time", () => {
    render(<PlatformFeeBalances balances={[]} nextInvoiceAt={nextInvoiceAt} feeBps={200} />);

    expect(screen.getByText(/Stripe Connect collects the 2% platform fee/)).toBeTruthy();
    expect(screen.getByText(/next invoice date is December 1, 2026/)).toBeTruthy();
  });

  it("shows this month's accrual and a carry forward notice per currency", () => {
    render(
      <PlatformFeeBalances
        balances={[{ currency: "usd", currentMinor: 120, carriedMinor: 300, minimumMinor: 500 }]}
        nextInvoiceAt={nextInvoiceAt}
        feeBps={200}
      />,
    );

    const card = screen.getByRole("listitem", { name: "USD platform fees" });
    expect(within(card).getByText("$1.20")).toBeTruthy();
    expect(within(card).getByText("$3.00")).toBeTruthy();
    expect(
      screen.getByText(
        "$3.00 from earlier months is below the $5.00 minimum, so it carries forward to the next invoice.",
      ),
    ).toBeTruthy();
  });
});

const row = (overrides: Partial<PlatformInvoiceRow>): PlatformInvoiceRow => ({
  id: "in-1",
  currency: "usd",
  periodStart: new Date("2026-10-01T00:00:00Z"),
  amountMinor: 700,
  status: "paid",
  number: "CHY-1",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
  dueAt: null,
  paidAt: new Date("2026-11-03T00:00:00Z"),
  ...overrides,
});

describe("PlatformInvoiceTable", () => {
  it("lists invoices with status, amount, and a link to the hosted invoice", () => {
    render(
      <PlatformInvoiceTable
        rows={[
          row({}),
          row({
            id: "in-2",
            periodStart: new Date("2026-11-01T00:00:00Z"),
            status: "past_due",
            dueAt: new Date("2026-12-15T00:00:00Z"),
            paidAt: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Paid November 3, 2026")).toBeTruthy();
    expect(screen.getByText("Past due")).toBeTruthy();
    const pay = screen.getByRole("link", { name: "Pay the November 2026 invoice (opens Stripe)" });
    expect(pay.getAttribute("href")).toBe("https://invoice.stripe.com/i/1");
    expect(pay.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows an empty state before the first invoice", () => {
    render(<PlatformInvoiceTable rows={[]} />);
    expect(screen.getByText("No invoices yet")).toBeTruthy();
  });
});

describe("PlatformBillingSettings", () => {
  it("offers the owner one primary action to add a card and saves the billing email", () => {
    const onAddCard = vi.fn();
    const onSaveEmail = vi.fn();
    render(
      <PlatformBillingSettings
        billingEmail={null}
        ownerEmail="owner@example.test"
        paymentMethodLabel={null}
        canManage
        onAddCard={onAddCard}
        onSaveEmail={onSaveEmail}
      />,
    );

    expect(screen.getByText("Invoices go to owner@example.test.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    expect(onAddCard).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Billing email"), {
      target: { value: " billing@example.test " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save email" }));
    expect(onSaveEmail).toHaveBeenCalledWith("billing@example.test");
  });

  it("keeps Save email enabled and explains an empty email on the field instead", () => {
    const onSaveEmail = vi.fn();
    render(
      <PlatformBillingSettings
        billingEmail={null}
        ownerEmail="owner@example.test"
        paymentMethodLabel={null}
        canManage
        onSaveEmail={onSaveEmail}
      />,
    );

    const save = screen.getByRole("button", { name: "Save email" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(onSaveEmail).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Billing email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a billing email, like name@example.com.")).toBeTruthy();
  });

  it("shows admins the card status without controls", () => {
    render(
      <PlatformBillingSettings
        billingEmail="billing@example.test"
        ownerEmail={null}
        paymentMethodLabel="Visa ending 4242"
        canManage={false}
      />,
    );

    expect(screen.getByText("Visa ending 4242")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Only the owner can change billing details.")).toBeTruthy();
  });
});
