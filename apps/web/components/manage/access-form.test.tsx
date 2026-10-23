import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccessForm, paidApprovalReason } from "./access-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/manage/join-actions", () => ({ saveAccessAction: vi.fn() }));

const initial = { joinMode: "open" as const, joinQuestions: [] };

describe("AccessForm", () => {
  it("disables approval with a one line reason while a plan is on sale", () => {
    render(<AccessForm slug="lab" initial={initial} planOnSale />);

    const approval = screen.getByRole<HTMLInputElement>("radio", { name: /^Approval/ });
    expect(approval.disabled).toBe(true);
    expect(screen.getByText(paidApprovalReason)).toBeTruthy();
    expect(screen.getByText(/Asked before checkout/)).toBeTruthy();
  });

  it("offers approval in a free community", () => {
    render(<AccessForm slug="lab" initial={initial} planOnSale={false} />);

    expect(screen.getByRole<HTMLInputElement>("radio", { name: /^Approval/ }).disabled).toBe(false);
    expect(screen.queryByText(paidApprovalReason)).toBeNull();
  });
});
