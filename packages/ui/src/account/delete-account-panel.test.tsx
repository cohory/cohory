import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeleteAccountPanel } from "./delete-account-panel";

describe("DeleteAccountPanel", () => {
  it("enables Delete account only after the email is typed", () => {
    render(
      <DeleteAccountPanel
        email="ada@example.test"
        graceDays={14}
        blockingCommunities={[]}
        action={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Delete account" });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Type your email address to confirm"), {
      target: { value: " ADA@example.test " },
    });

    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/under the name Former member/)).toBeTruthy();
  });

  it("says what is kept after deletion and links the Privacy Policy", () => {
    render(
      <DeleteAccountPanel
        email="ada@example.test"
        graceDays={14}
        blockingCommunities={[]}
        action={vi.fn()}
        privacyHref="/privacy"
      />,
    );

    expect(
      screen.getByText(
        /Payment records stay with Stripe and the creators you paid, as tax law requires\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("lists owned communities instead of the form", () => {
    render(
      <DeleteAccountPanel
        email="ada@example.test"
        graceDays={14}
        blockingCommunities={[
          { name: "Makers", href: "/c/makers/manage/settings", reason: "active" },
          { name: "Gardeners", href: "/c/gardeners/manage/settings", reason: "active" },
        ]}
        action={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("You own 2 communities");
    expect(screen.getByRole("link", { name: "Makers" }).getAttribute("href")).toBe(
      "/c/makers/manage/settings",
    );
  });

  it("lists archived communities that still bill with a link to Payments", () => {
    render(
      <DeleteAccountPanel
        email="ada@example.test"
        graceDays={14}
        blockingCommunities={[
          { name: "Makers", href: "/c/makers/manage/settings", reason: "active" },
          { name: "Old club", href: "/c/old-club/manage/payments", reason: "billing" },
        ]}
        action={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("You own a community.");
    expect(alert).toContain(
      "An archived community you own still bills members or has Stripe connected.",
    );
    expect(screen.getByRole("link", { name: "Old club" }).getAttribute("href")).toBe(
      "/c/old-club/manage/payments",
    );
  });
});
