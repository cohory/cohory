import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SmallPrint } from "./checkout-small-print";

const links = { termsHref: "/terms", privacyHref: "/privacy" };

describe("checkout small print", () => {
  it("names the seller and the creator's refund rule before the member pays", () => {
    render(
      <SmallPrint
        providerName="Stripe"
        checkout={{ ...links, seller: "Dana Coach", refundPolicy: "Full refund within 14 days." }}
      />,
    );

    expect(screen.getByText("Sold by Dana Coach. Full refund within 14 days.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  });

  it("tells the member to ask the creator when no refund rule is set", () => {
    render(
      <SmallPrint
        providerName="Stripe"
        checkout={{ ...links, seller: null, refundPolicy: null }}
      />,
    );

    expect(screen.getByText("Ask the creator for refunds.")).toBeTruthy();
  });
});
