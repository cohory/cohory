import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExistingSubscribersCard } from "./existing-subscribers-card";
import { SubscriberLinkList, type SubscriberLinkRow } from "./subscriber-link-list";

const row: SubscriberLinkRow = {
  id: "sub_1",
  email: "ada@example.test",
  customerName: "Ada",
  status: "past_due",
  unitAmountMinor: 2900,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  currentPeriodEnd: new Date("2026-11-03T12:00:00.000Z"),
  cancelAtPeriodEnd: false,
  match: { kind: "member", name: "Ada Lovelace" },
  block: null,
  allowed: ["link_member", "skip"],
};

describe("ExistingSubscribersCard", () => {
  it("links to the review page once Stripe is connected and states the limits", () => {
    render(<ExistingSubscribersCard href="/c/x/manage/migration/subscribers" connected linking />);
    expect(screen.getByText("Bring your existing subscribers")).toBeTruthy();
    expect(screen.getByText(/No card details move/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review existing subscriptions" }).getAttribute("href"),
    ).toBe("/c/x/manage/migration/subscribers");
  });

  it("asks to connect Stripe first and shows counts", () => {
    render(
      <ExistingSubscribersCard
        href="/x"
        connected={false}
        linking
        linkedCount={1}
        invitedCount={2}
      />,
    );
    expect(screen.queryByRole("link", { name: "Review existing subscriptions" })).toBeNull();
    expect(screen.getByRole("link", { name: "Move paying members" })).toBeTruthy();
    expect(screen.getByText(/Connect the Stripe account/)).toBeTruthy();
    expect(screen.getByText("1 subscription linked, 2 people invited.")).toBeTruthy();
  });

  it("on Cloud offers only the move with free time, never linking", () => {
    render(<ExistingSubscribersCard href="/x" connected linking={false} linkedCount={3} />);
    expect(screen.queryByRole("link", { name: "Review existing subscriptions" })).toBeNull();
    expect(screen.queryByText(/Link those subscriptions/)).toBeNull();
    expect(screen.queryByText(/subscriptions linked/)).toBeNull();
    expect(screen.getByText(/free time until their old renewal date/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Move paying members" }).getAttribute("href")).toBe(
      "/x",
    );
  });
});

describe("SubscriberLinkList", () => {
  it("shows the price, status, renewal, and match, and reports choices", () => {
    const onChange = vi.fn();
    render(
      <SubscriberLinkList
        rows={[row]}
        choices={{ sub_1: { action: "link_member", interval: null } }}
        onChange={onChange}
        timeZone="UTC"
      />,
    );
    expect(screen.getByText("Past due")).toBeTruthy();
    expect(screen.getByText(/\$29\.00 per month · Renews/)).toBeTruthy();
    expect(screen.getByText("Member: Ada Lovelace")).toBeTruthy();
    const period = screen.getByRole("combobox", { name: "Membership period for ada@example.test" });
    expect(period.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(period, { target: { value: "year" } });
    expect(onChange).toHaveBeenCalledWith("sub_1", { action: "link_member", interval: "year" });
    fireEvent.change(screen.getByRole("combobox", { name: "Action for ada@example.test" }), {
      target: { value: "skip" },
    });
    expect(onChange).toHaveBeenLastCalledWith("sub_1", { action: "skip", interval: null });
  });

  it("explains blocked rows without offering choices", () => {
    render(
      <SubscriberLinkList
        rows={[{ ...row, block: "other_platform", allowed: ["skip"], status: "active" }]}
        choices={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Created by another platform. Can't be linked.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
