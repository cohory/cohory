import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaidMembershipList, type PaidMembershipItem } from "./paid-membership-list";

const open: PaidMembershipItem = {
  communitySlug: "makers",
  communityName: "Makers",
  planName: "Makers membership",
  amountMinor: 4900,
  currency: "usd",
  interval: "month",
  providerStatus: "active",
  nextChargeAt: new Date("2026-11-18T10:00:00Z"),
  endsAt: null,
  billing: { kind: "portal" },
};

const direct: PaidMembershipItem = {
  ...open,
  communitySlug: "old-club",
  communityName: "Old club",
  nextChargeAt: null,
  endsAt: new Date("2026-12-01T10:00:00Z"),
  billing: { kind: "direct", supportContact: "owner@example.test" },
};

describe("PaidMembershipList", () => {
  it("shows plan, price, status, next charge, and Manage billing for an open connection", () => {
    const onManageBilling = vi.fn();
    render(<PaidMembershipList items={[open]} onManageBilling={onManageBilling} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: "Makers" }).getAttribute("href")).toBe(
      "/c/makers",
    );
    expect(row.textContent).toContain("Makers membership");
    expect(row.textContent).toContain("$49.00/month");
    expect(row.textContent).toContain("Active");
    expect(row.textContent).toContain("Next charge on November 18, 2026");
    fireEvent.click(within(row).getByRole("button", { name: "Manage billing" }));
    expect(onManageBilling).toHaveBeenCalledWith("makers");
  });

  it("says who bills directly and how to reach them when the connection is closed", () => {
    render(<PaidMembershipList items={[direct]} onManageBilling={vi.fn()} />);

    const row = screen.getByRole("listitem");
    expect(within(row).queryByRole("button", { name: "Manage billing" })).toBeNull();
    expect(row.textContent).toContain("Billed directly by Old club");
    expect(row.textContent).toContain("Ends on December 1, 2026");
    expect(within(row).getByRole("link", { name: "owner@example.test" }).getAttribute("href")).toBe(
      "mailto:owner@example.test",
    );
  });

  it("explains an empty list", () => {
    render(<PaidMembershipList items={[]} onManageBilling={vi.fn()} />);

    expect(screen.getByText(/^You have no paid memberships\./)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
