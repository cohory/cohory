import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JoinPanel } from "./join-panel";

const path = vi.hoisted(() => ({ current: "/c/makers/about" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("../../app/c/[slug]/actions", () => ({ startJoinIntentAction: vi.fn() }));
vi.mock("../join-button", () => ({ JoinButton: () => null }));
vi.mock("./join-request-dialog", () => ({ JoinRequestDialog: () => null }));
vi.mock("./join-request-form", () => ({ JoinRequestForm: () => null }));

describe("JoinPanel", () => {
  it("starts checkout from a button for a signed in visitor, with a yearly choice", () => {
    render(
      <JoinPanel
        slug="makers"
        name="Makers"
        state={{
          kind: "paid",
          paidJoin: {
            label: "Join for $10.00/month",
            yearlyLabel: "Yearly $100.00",
            asksQuestions: false,
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Join for $10.00/month" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Yearly $100.00" })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Join for/ })).toBeNull();
  });

  it("offers the yearly choice to a signed out visitor too", () => {
    render(
      <JoinPanel
        slug="makers"
        name="Makers"
        state={{
          kind: "sign_up",
          intent: "checkout",
          label: "Join for $10.00/month",
          yearlyLabel: "Yearly $100.00",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Yearly $100.00" })).toBeDefined();
  });

  it("hides the checkout buttons on the membership page, which has its own", () => {
    path.current = "/c/makers/membership";
    render(
      <JoinPanel
        slug="makers"
        name="Makers"
        state={{
          kind: "paid",
          paidJoin: { label: "Join for $10.00/month", yearlyLabel: null, asksQuestions: false },
        }}
      />,
    );
    path.current = "/c/makers/about";

    expect(screen.queryByRole("button", { name: /Join for/ })).toBeNull();
  });

  it("sends a visitor to the membership page first when the community asks join questions", () => {
    render(
      <JoinPanel
        slug="makers"
        name="Makers"
        state={{
          kind: "paid",
          paidJoin: { label: "Join for $10.00/month", yearlyLabel: null, asksQuestions: true },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Join for $10.00/month" }).getAttribute("href")).toBe(
      "/c/makers/membership",
    );
  });

  it("shows no yearly choice without a yearly price", () => {
    render(
      <JoinPanel
        slug="makers"
        name="Makers"
        state={{
          kind: "paid",
          paidJoin: { label: "Join for $10.00/month", yearlyLabel: null, asksQuestions: false },
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Yearly/ })).toBeNull();
  });
});
