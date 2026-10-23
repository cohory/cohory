import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectionStatus } from "./connection-status";
import { platformFeeLine } from "./fee-copy";
import { MembershipStatus } from "./membership-status";
import { PaymentProviderSelector } from "./payment-provider-selector";

describe("choosing a bring your own provider", () => {
  it("lists Polar next to Stripe Connect on Cloud with the monthly billing limits", () => {
    render(
      <PaymentProviderSelector
        edition="cloud"
        providers={["stripe_connect", "polar"]}
        platformFeeBps={200}
        canConnect
      />,
    );
    const group = screen.getByRole("group", { name: "How members pay you" });
    expect(within(group).getByRole("radio", { name: /Stripe Connect/ })).toHaveProperty(
      "checked",
      true,
    );
    const polar = within(group).getByRole("radio", { name: /Polar/ });
    expect(polar.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      screen.getByText(/The 2% platform fee is recorded on each payment and billed to you monthly/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect your Stripe account" })).toBeTruthy();
  });

  it("sends the Polar token and environment when Polar is chosen", () => {
    const onSubmitProvider = vi.fn();
    render(
      <PaymentProviderSelector
        edition="community"
        providers={["stripe_own_keys", "polar"]}
        canConnect
        onSubmitProvider={onSubmitProvider}
      />,
    );
    expect(screen.getByText("No platform fee. Polar's own fees are separate.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Polar/ }));
    expect(screen.queryByLabelText("Secret key")).toBeNull();
    fireEvent.change(screen.getByLabelText("Organization access token"), {
      target: { value: "  polar_oat_abcdefghijklmnopqrstuvwxyz  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Polar" }));
    expect(onSubmitProvider).toHaveBeenCalledWith("polar", {
      accessToken: "polar_oat_abcdefghijklmnopqrstuvwxyz",
      server: "sandbox",
    });
  });

  it("refuses a short token before it reaches the server", () => {
    const onSubmitProvider = vi.fn();
    render(
      <PaymentProviderSelector
        edition="cloud"
        providers={["polar"]}
        canConnect
        onSubmitProvider={onSubmitProvider}
      />,
    );
    fireEvent.change(screen.getByLabelText("Organization access token"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Polar" }));
    expect(onSubmitProvider).not.toHaveBeenCalled();
    expect(screen.getByText("Paste the full Polar access token, without spaces.")).toBeTruthy();
  });
});

describe("a connected Polar account", () => {
  const base = {
    provider: "polar" as const,
    providerName: "Polar",
    status: "onboarding" as const,
    chargesEnabled: true,
    externalAccountId: "org_1",
    livemode: false,
    webhookUrl: "https://app.test/api/webhooks/payments/abc",
    canManage: true,
  };

  it("shows the webhook URL and asks for the signing secret first", () => {
    const onSaveWebhookSecret = vi.fn();
    render(<ConnectionStatus {...base} onSaveWebhookSecret={onSaveWebhookSecret} />);
    expect(screen.getByText("Add the webhook to finish")).toBeTruthy();
    expect(screen.getByText("https://app.test/api/webhooks/payments/abc")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send test event" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Webhook signing secret"), {
      target: { value: "whsec_abcdefghijklmnop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save signing secret" }));
    expect(onSaveWebhookSecret).toHaveBeenCalledWith("whsec_abcdefghijklmnop");
  });

  it("offers a test event once the secret is saved and reports the last event", () => {
    const onSendTest = vi.fn();
    render(
      <ConnectionStatus
        {...base}
        status="active"
        webhookSecretSaved
        lastWebhookAt={new Date("2026-10-19T10:00:00Z")}
        feeBilledMonthly
        onSendTest={onSendTest}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText("Polar can take payments for this community.")).toBeTruthy();
    expect(screen.getByText(/Last event received Oct 19, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send test event" }));
    expect(onSendTest).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Polar" }));
    expect(screen.getByText(/stay on your next monthly invoice/)).toBeTruthy();
  });

  it("names the provider in the fee line and in the member's billing note", () => {
    expect(platformFeeLine("cloud", 200, { name: "Polar", feeSplit: false })).toBe(
      "Platform fee: 2% of each successful payment, recorded here and billed to you monthly. Polar processing fees are separate.",
    );
    render(
      <MembershipStatus
        kind="past_due"
        providerName="Polar"
        canManageBilling
        onManageBilling={vi.fn()}
      />,
    );
    expect(screen.getByText(/Polar retries the payment automatically/)).toBeTruthy();
    expect(screen.getByText(/opens the Polar customer portal/)).toBeTruthy();
  });
});
