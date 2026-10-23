import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signOut } from "../lib/auth/actions";
import { SupportLinksProvider } from "./support-links";
import { UserMenu } from "./user-menu";

vi.mock("../lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/c/makers/classroom" }));

afterEach(() => {
  window.localStorage.clear();
});

const communities = [
  { slug: "makers", name: "Makers Guild", unread: 2 },
  { slug: "writers", name: "Writers Room" },
];

function open() {
  const trigger = screen.getByRole("button", { name: "Open account menu for Ana Lima" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("UserMenu", () => {
  it("names the trigger with the person's name and hides the initials", () => {
    render(
      <UserMenu name="Ana Lima" email="ana@example.com" image={null} communities={communities} />,
    );

    const trigger = screen.getByRole("button", { name: "Open account menu for Ana Lima" });
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(screen.getByText("AL").closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("holds account links, your communities, create, and sign out in that order", () => {
    render(
      <UserMenu
        name="Ana Lima"
        email="ana@example.com"
        image={null}
        communities={communities}
        currentSlug="writers"
      />,
    );
    open();

    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Account",
      "Notification settings",
      "Billing",
      "Home",
      "MMakers Guild2 unread",
      "WWriters Room",
      "Create a community",
      "Sign out",
    ]);
    expect(items[1]?.getAttribute("href")).toBe("/account/notifications");
    expect(items[2]?.getAttribute("href")).toBe("/account/billing");
    expect(items[5]?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("group", { name: "Your communities" })).toBeTruthy();
  });

  it("leaves out Create a community for someone the server does not let create one", () => {
    render(
      <UserMenu
        name="Ana Lima"
        email="ana@example.com"
        image={null}
        communities={communities}
        canCreate={false}
      />,
    );
    open();

    expect(screen.queryByRole("menuitem", { name: "Create a community" })).toBeNull();
  });

  it("offers Request early access instead of Create a community to someone who may not create one", () => {
    render(
      <UserMenu
        name="Ana Lima"
        email="ana@example.com"
        image={null}
        communities={communities}
        canCreate={false}
        earlyAccessHref="/early-access"
      />,
    );
    open();

    expect(screen.queryByRole("menuitem", { name: "Create a community" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Request early access" }).getAttribute("href"),
    ).toBe("/early-access");
  });

  it("never offers early access to someone who may create a community", () => {
    render(
      <UserMenu
        name="Ana Lima"
        email="ana@example.com"
        image={null}
        communities={communities}
        earlyAccessHref="/early-access"
      />,
    );
    open();

    expect(screen.queryByRole("menuitem", { name: "Request early access" })).toBeNull();
  });

  it("offers Send feedback with the current page when the contact form is on", () => {
    render(
      <SupportLinksProvider links={{ contact: "/contact", status: null }}>
        <UserMenu name="Ana Lima" email="ana@example.com" image={null} communities={communities} />
      </SupportLinksProvider>,
    );
    open();

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(-2)).toEqual(["Send feedback", "Sign out"]);
    expect(screen.getByRole("menuitem", { name: "Send feedback" }).getAttribute("href")).toBe(
      "/contact?topic=feedback&from=%2Fc%2Fmakers%2Fclassroom",
    );
  });

  it("leaves out Send feedback when the server has no contact form", () => {
    render(
      <UserMenu name="Ana Lima" email="ana@example.com" image={null} communities={communities} />,
    );
    open();

    expect(screen.queryByRole("menuitem", { name: "Send feedback" })).toBeNull();
  });

  it("forgets drafts saved on this device when signing out", () => {
    window.localStorage.setItem("cohory:draft:post:makers", "{}");
    render(
      <UserMenu name="Ana Lima" email="ana@example.com" image={null} communities={communities} />,
    );
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(window.localStorage.getItem("cohory:draft:post:makers")).toBeNull();
    expect(vi.mocked(signOut)).toHaveBeenCalledOnce();
  });
});
