import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { savePlanAction } from "../../lib/payments/actions";
import { PlanEditor, priceChangeSummary } from "./plan-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/payments/actions", () => ({
  savePlanAction: vi.fn(),
  archivePlanAction: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const current = { currency: "usd", monthlyPriceMinor: 1000, annualPriceMinor: null };

function editor(props: Partial<Parameters<typeof PlanEditor>[0]> = {}) {
  return (
    <PlanEditor
      slug="lab"
      currencies={["usd"]}
      plan={current}
      state="on_sale"
      canSell
      payingCount={3}
      platformFeeBps={200}
      providerName="Stripe"
      disabled={false}
      {...props}
    />
  );
}

describe("priceChangeSummary", () => {
  it("says what current and new members pay", () => {
    expect(priceChangeSummary(current, { ...current, monthlyPriceMinor: 1500 }, 3)).toBe(
      "3 members keep $10.00 a month. New members pay $15.00 a month.",
    );
    expect(priceChangeSummary(current, { ...current, monthlyPriceMinor: 1500 }, 1)).toBe(
      "1 member keeps $10.00 a month. New members pay $15.00 a month.",
    );
  });
});

describe("PlanEditor", () => {
  it("asks before changing the price of a plan people pay for", () => {
    render(editor());

    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));

    expect(screen.getByRole("dialog", { name: "Change the price?" })).toBeTruthy();
    expect(
      screen.getByText("3 members keep $10.00 a month. New members pay $15.00 a month."),
    ).toBeTruthy();
    expect(savePlanAction).not.toHaveBeenCalled();
  });

  it("saves a draft at once while Stripe is not ready", () => {
    vi.mocked(savePlanAction).mockResolvedValue({
      ok: false,
      message: "Try again.",
    });
    render(editor({ plan: null, state: "none", canSell: false, payingCount: 0 }));

    fireEvent.change(screen.getByLabelText("Monthly price"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(savePlanAction).toHaveBeenCalledWith({
      slug: "lab",
      currency: "usd",
      monthlyPriceMinor: 1500,
      annualPriceMinor: null,
    });
  });
});
