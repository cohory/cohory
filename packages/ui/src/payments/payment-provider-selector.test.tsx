import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaymentProviderSelector } from "./payment-provider-selector";

const terms = { terms: "/legal/creator-terms", dpa: "/legal/dpa" };

describe("PaymentProviderSelector", () => {
  it("offers Stripe Connect on Cloud and leaves the fee line to the page", () => {
    const onConnectStripe = vi.fn();
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        onConnectStripe={onConnectStripe}
        creatorTerms={terms}
      />,
    );

    expect(screen.getByText("Stripe Connect")).toBeTruthy();
    expect(screen.queryByText(/platform fee/i)).toBeNull();
    expect(screen.queryByLabelText("Secret key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect your Stripe account" }));
    expect(onConnectStripe).toHaveBeenCalledWith("US", true);
  });

  it("names the Creator Terms, the DPA, and Stripe's agreement next to the Connect button", () => {
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        onConnectStripe={vi.fn()}
        creatorTerms={{ terms: "/legal/creator-terms", dpa: "/legal/dpa" }}
      />,
    );

    expect(screen.getByText(/By connecting, you agree to the/).textContent).toBe(
      "By connecting, you agree to the Creator Terms and the Data Processing Agreement. Payment processing is provided by Stripe under the Stripe Connected Account Agreement.",
    );
    expect(screen.getByRole("link", { name: "Creator Terms" }).getAttribute("href")).toBe(
      "/legal/creator-terms",
    );
    expect(screen.getByRole("link", { name: "Data Processing Agreement" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stripe Connected Account Agreement" })).toBeTruthy();
  });

  it("blocks Connect with a plain message when the server has no Creator Terms", () => {
    const onConnectStripe = vi.fn();
    render(
      <PaymentProviderSelector edition="cloud" canConnect onConnectStripe={onConnectStripe} />,
    );

    expect(screen.queryByText(/By connecting/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "This server has no Creator Terms yet, so Stripe cannot be connected.",
    );
    const connect = screen.getByRole("button", { name: "Connect your Stripe account" });
    expect(connect.hasAttribute("disabled")).toBe(true);
    fireEvent.click(connect);
    expect(onConnectStripe).not.toHaveBeenCalled();
  });

  it("preselects the country from the browser language and names it", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE", "en"]);
    render(<PaymentProviderSelector edition="cloud" canConnect onConnectStripe={vi.fn()} />);

    const select = screen.getByLabelText<HTMLSelectElement>("Country of your business");
    expect(select.value).toBe("DE");
    expect(screen.queryByRole("option", { name: "Same as this platform" })).toBeNull();
    vi.restoreAllMocks();
  });

  it("asks for a country when the browser language names none Stripe supports", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["sw-KE"]);
    const onConnectStripe = vi.fn();
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        onConnectStripe={onConnectStripe}
        creatorTerms={terms}
      />,
    );

    const connect = screen.getByRole("button", { name: "Connect your Stripe account" });
    expect(connect.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Country of your business"), {
      target: { value: "GB" },
    });
    fireEvent.click(connect);
    expect(onConnectStripe).toHaveBeenCalledWith("GB", true);
    vi.restoreAllMocks();
  });

  it("asks the owner to confirm their email before connecting Stripe", () => {
    const onConnectStripe = vi.fn();
    const onSendLink = vi.fn();
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        onConnectStripe={onConnectStripe}
        confirmEmail={{ email: "owner@example.com", pending: false, message: null, onSendLink }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect your Stripe account" })).toBeNull();
    expect(screen.getByText("Confirm your email first")).toBeTruthy();
    expect(screen.getByText(/owner@example\.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(onSendLink).toHaveBeenCalledOnce();
    expect(onConnectStripe).not.toHaveBeenCalled();
  });

  it("shows what happened after a new link was asked for", () => {
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        confirmEmail={{
          email: "owner@example.com",
          pending: false,
          message: "We sent a new link to owner@example.com.",
          onSendLink: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("We sent a new link to owner@example.com.");
  });

  it("asks for the country of the business and passes it to Stripe Connect", () => {
    const onConnectStripe = vi.fn();
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        onConnectStripe={onConnectStripe}
        creatorTerms={terms}
      />,
    );

    fireEvent.change(screen.getByLabelText("Country of your business"), {
      target: { value: "DE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect your Stripe account" }));

    expect(onConnectStripe).toHaveBeenCalledWith("DE", true);
    expect(screen.getByRole("option", { name: "Germany" })).toBeTruthy();
  });

  it("offers own keys only on the Community Edition", () => {
    const onSubmitOwnKeys = vi.fn();
    render(
      <PaymentProviderSelector edition="community" canConnect onSubmitOwnKeys={onSubmitOwnKeys} />,
    );

    expect(screen.queryByText("Stripe Connect")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect your Stripe account" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: " sk_test_123 " } });
    fireEvent.change(screen.getByLabelText("Webhook signing secret"), {
      target: { value: "whsec_abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Stripe" }));
    expect(onSubmitOwnKeys).toHaveBeenCalledWith({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_abc",
    });
  });

  it("checks the key format before submitting own keys", () => {
    const onSubmitOwnKeys = vi.fn();
    render(
      <PaymentProviderSelector edition="community" canConnect onSubmitOwnKeys={onSubmitOwnKeys} />,
    );

    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "pk_test_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Stripe" }));

    expect(onSubmitOwnKeys).not.toHaveBeenCalled();
    expect(screen.getByText("Paste a secret key that starts with sk_ or rk_.")).toBeTruthy();
    expect(
      screen.getByText("Paste the webhook signing secret that starts with whsec_."),
    ).toBeTruthy();
  });

  it("tells people who are not the owner why they can't connect", () => {
    render(<PaymentProviderSelector edition="cloud" canConnect={false} />);

    expect(screen.queryByRole("button", { name: "Connect your Stripe account" })).toBeNull();
    expect(screen.getByText("Only the owner can connect a payment account.")).toBeTruthy();
  });

  it("shows a pending state and an error", () => {
    render(
      <PaymentProviderSelector
        edition="cloud"
        canConnect
        pending
        error="Stripe isn't set up on this server yet."
        creatorTerms={terms}
      />,
    );

    expect(screen.getByRole("button", { name: "Opening Stripe" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Stripe isn't set up on this server yet.",
    );
  });
});
