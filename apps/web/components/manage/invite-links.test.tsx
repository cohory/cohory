import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InviteRow } from "../../lib/manage/views";
import { InviteLinks, paidInviteApprovalReason } from "./invite-links";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/manage/actions", () => ({
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));
vi.mock("./overview/actions", () => ({ markSetupAction: vi.fn() }));

const invite: InviteRow = {
  id: "invite-1",
  url: "https://cohory.test/join/abc",
  expiresAt: null,
  maxUses: null,
  useCount: 2,
  requiresApproval: true,
  label: null,
  revokedAt: null,
  status: "active",
};

function openDialog(planOnSale: boolean) {
  render(<InviteLinks slug="lab" invites={[invite]} planOnSale={planOnSale} />);
  fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
}

describe("InviteLinks", () => {
  it("turns off the approval switch with a reason while a plan is on sale", () => {
    openDialog(true);

    const approval = screen.getByRole("switch", { name: /need approval/ });
    expect(approval).toHaveProperty("disabled", true);
    expect(screen.getByText(paidInviteApprovalReason)).toBeTruthy();
    expect(screen.queryByText(/never expires, needs approval/)).toBeNull();
    expect(screen.getByText(/never expires/)).toBeTruthy();
  });

  it("offers approval for invite links in a free community", () => {
    openDialog(false);

    expect(screen.getByRole("switch", { name: /need approval/ })).toHaveProperty("disabled", false);
    expect(screen.queryByText(paidInviteApprovalReason)).toBeNull();
    expect(screen.getByText(/never expires, needs approval/)).toBeTruthy();
  });
});
