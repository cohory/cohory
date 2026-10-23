import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectionStatus } from "./connection-status";
import { LedgerSummary } from "./ledger-summary";
import { MembershipStatus } from "./membership-status";
import { SubscriptionTable, type SubscriptionRow } from "./subscription-table";

const periodEnd = new Date("2026-11-03T12:00:00Z");

describe("MembershipStatus", () => {
  it("shows the next payment date for an active membership", () => {
    render(<MembershipStatus kind="active" interval="month" periodEnd={periodEnd} />);

    expect(screen.getByText("Monthly membership. Next payment November 3, 2026.")).toBeTruthy();
  });

  it("shows access until the end of the period when canceling", () => {
    render(<MembershipStatus kind="canceling" interval="year" periodEnd={periodEnd} />);

    expect(screen.getByText("Access until November 3, 2026")).toBeTruthy();
  });

  it("shows a past due banner with a primary manage billing button", () => {
    const onManageBilling = vi.fn();
    render(
      <MembershipStatus
        kind="past_due"
        canManageBilling
        onManageBilling={onManageBilling}
        periodEnd={periodEnd}
      />,
    );

    expect(screen.getByText("Payment failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    expect(onManageBilling).toHaveBeenCalled();
  });

  it("names the plan, amount, interval, and next payment date together", () => {
    render(
      <MembershipStatus
        kind="active"
        planName="Makers"
        price={{ amountMinor: 1000, currency: "usd", interval: "month" }}
        periodEnd={periodEnd}
      />,
    );

    expect(
      screen.getByText("Makers membership. $10.00 per month. Next payment November 3, 2026."),
    ).toBeTruthy();
  });

  it("does not repeat the word membership when the plan is named Membership", () => {
    render(
      <MembershipStatus
        kind="active"
        planName="Membership"
        price={{ amountMinor: 29000, currency: "usd", interval: "year" }}
        periodEnd={periodEnd}
      />,
    );

    expect(
      screen.getByText("Membership. $290.00 per year. Next payment November 3, 2026."),
    ).toBeTruthy();
  });

  it("keeps the price on a past due membership", () => {
    render(
      <MembershipStatus
        kind="past_due"
        planName="Makers"
        price={{ amountMinor: 10000, currency: "usd", interval: "year" }}
      />,
    );

    expect(screen.getByText(/^Makers membership\. \$100\.00 per year\. Update/)).toBeTruthy();
  });

  it("shows a paused membership with access until the paid date and a resume button", () => {
    const onResume = vi.fn();
    render(
      <MembershipStatus
        kind="paused"
        planName="Makers"
        price={{ amountMinor: 1000, currency: "usd", interval: "month" }}
        periodEnd={periodEnd}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("Payments paused")).toBeTruthy();
    expect(screen.getByText(/You keep access until November 3, 2026\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume payments" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("hides manage billing without a billing account", () => {
    render(<MembershipStatus kind="free" onManageBilling={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Manage billing" })).toBeNull();
  });
});

const row: SubscriptionRow = {
  id: "s1",
  memberName: "Ana Lima",
  memberEmail: "ana@example.com",
  providerStatus: "active",
  interval: "month",
  currentPeriodEnd: periodEnd,
  cancelAtPeriodEnd: false,
  endedAt: null,
  amountMinor: 4900,
  currency: "usd",
  dashboardUrl: "https://dashboard.stripe.com/acct_1/test/subscriptions/sub_1",
};

describe("SubscriptionTable", () => {
  it("lists members with status and renewal", () => {
    render(
      <SubscriptionTable
        rows={[row, { ...row, id: "s2", memberName: "Bo", providerStatus: "past_due" }]}
      />,
    );

    expect(screen.getByText("Ana Lima")).toBeTruthy();
    expect(screen.getByText("Past due")).toBeTruthy();
    expect(screen.getAllByText("Renews November 3, 2026")).toHaveLength(4);
  });

  it("stacks the period under the status on narrow screens instead of a fourth column", () => {
    render(<SubscriptionTable rows={[row]} />);

    const header = screen.getByRole("columnheader", { name: "Period" });
    expect(header.className).toContain("hidden");
    expect(header.className).toContain("sm:table-cell");
    const [stacked, column] = screen.getAllByText("Renews November 3, 2026");
    expect(stacked?.closest("td")).toBe(screen.getByText("Active").closest("td"));
    expect(stacked?.className).toContain("sm:hidden");
    expect(column?.className).toContain("hidden");
    expect(column?.className).toContain("sm:table-cell");
  });

  it("marks canceling subscriptions with their end date", () => {
    render(<SubscriptionTable rows={[{ ...row, cancelAtPeriodEnd: true }]} />);

    expect(screen.getByText("Canceling")).toBeTruthy();
    expect(screen.getAllByText("Ends November 3, 2026")).toHaveLength(2);
  });

  it("shows each member's plan price and links to the subscription in Stripe", () => {
    render(
      <SubscriptionTable
        rows={[
          row,
          { ...row, id: "s2", interval: "year", amountMinor: 49_000, dashboardUrl: null },
        ]}
      />,
    );

    expect(screen.getByText("$49.00 a month")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Plan price" })).toBeTruthy();
    expect(screen.getByText("$490.00 a year")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Open in Stripe: Ana Lima" });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(row.dashboardUrl);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
  });

  it("filters members by status", () => {
    render(
      <SubscriptionTable
        rows={[
          row,
          { ...row, id: "s2", memberName: "Bo", providerStatus: "past_due" },
          { ...row, id: "s3", memberName: "Cy", cancelAtPeriodEnd: true },
          { ...row, id: "s4", memberName: "Di", providerStatus: "canceled", endedAt: periodEnd },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Past due (1)" }));
    expect(screen.queryByText("Ana Lima")).toBeNull();
    expect(screen.getByText("Bo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Canceling (1)" }));
    expect(screen.getByText("Cy")).toBeTruthy();
    expect(screen.queryByText("Bo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ended (1)" }));
    expect(screen.getByText("Di")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All (4)" }));
    expect(screen.getByText("Ana Lima")).toBeTruthy();
  });

  it("has an empty state", () => {
    render(<SubscriptionTable rows={[]} />);

    expect(screen.getByText("No paid members yet")).toBeTruthy();
  });
});

describe("LedgerSummary", () => {
  const totals = {
    currency: "usd",
    paymentCount: 3,
    grossMinor: 8700,
    refundedMinor: 0,
    netPlatformFeeMinor: 87,
  };

  it("shows gross and platform fee per currency on Cloud", () => {
    render(<LedgerSummary edition="cloud" currencies={[totals]} />);

    expect(screen.getByText("3 payments")).toBeTruthy();
    expect(screen.getByText("$87.00")).toBeTruthy();
    expect(screen.getByText("$0.87")).toBeTruthy();
    expect(screen.getByText("Platform fee")).toBeTruthy();
    expect(screen.queryByText(/of each successful payment/)).toBeNull();
  });

  it("shows no platform fee row on the Community Edition", () => {
    render(<LedgerSummary edition="community" currencies={[totals]} />);

    expect(screen.queryByText("Platform fee")).toBeNull();
    expect(screen.queryByText(/platform fee/)).toBeNull();
  });

  it("has an empty state", () => {
    render(<LedgerSummary edition="cloud" currencies={[]} />);

    expect(screen.getByText("No payments yet")).toBeTruthy();
  });
});

describe("ConnectionStatus", () => {
  it("asks for confirmation before it disconnects", () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage
        onDisconnect={onDisconnect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Stripe" }));
    expect(screen.getByText("Disconnect Stripe?")).toBeTruthy();
    expect(onDisconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(screen.queryByText("Disconnect Stripe?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Stripe" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("hands the disconnect to the page when it shows its own dialog", () => {
    const onRequestDisconnect = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage
        onDisconnect={onDisconnect}
        onRequestDisconnect={onRequestDisconnect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Stripe" }));

    expect(onRequestDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Disconnect Stripe?")).toBeNull();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("shows a disconnecting connection with paused checkouts and no other actions", () => {
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="disconnecting"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage
        onRefresh={vi.fn()}
        onDisconnect={vi.fn()}
      >
        <p>Run details</p>
      </ConnectionStatus>,
    );

    expect(screen.getByText("Disconnecting")).toBeTruthy();
    expect(screen.getByText("Disconnecting Stripe")).toBeTruthy();
    expect(
      screen.getByText(
        "We are removing the Cohory fee from every subscription before the connection closes. New memberships are paused until then.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Run details")).toBeTruthy();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect Stripe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check status" })).toBeNull();
  });

  it("hides the disconnect control from people who cannot manage the connection", () => {
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage={false}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Disconnect Stripe" })).toBeNull();
  });

  it("reports a ready account", () => {
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Test mode")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish Stripe setup" })).toBeNull();
  });

  it("explains test mode and how to try a purchase", () => {
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode={false}
        canManage
      />,
    );

    expect(screen.getByText("No real money moves in test mode")).toBeTruthy();
    expect(screen.getByText(/4242 4242 4242 4242/)).toBeTruthy();
  });

  it("does not explain test mode for a live account", () => {
    render(
      <ConnectionStatus
        provider="stripe_own_keys"
        status="active"
        chargesEnabled
        externalAccountId="acct_1"
        livemode
        canManage
      />,
    );

    expect(screen.queryByText("No real money moves in test mode")).toBeNull();
  });

  it("asks the owner to finish onboarding", () => {
    const onContinue = vi.fn();
    render(
      <ConnectionStatus
        provider="stripe_connect"
        status="onboarding"
        chargesEnabled={false}
        externalAccountId="acct_1"
        livemode={false}
        canManage
        onContinue={onContinue}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Stripe needs more information")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish Stripe setup" }));
    expect(onContinue).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  it("shows the webhook URL for own keys behind details", () => {
    render(
      <ConnectionStatus
        provider="stripe_own_keys"
        status="active"
        chargesEnabled
        externalAccountId="acct_2"
        livemode={false}
        webhookUrl="https://example.com/api/webhooks/stripe/own/c1"
        canManage
      />,
    );

    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("https://example.com/api/webhooks/stripe/own/c1")).toBeTruthy();
  });
});
