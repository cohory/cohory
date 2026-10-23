import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountNav } from "./account-nav";

const path = vi.hoisted(() => ({ current: "/account" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

function links(name: string): string[] {
  const nav = screen.getByRole("navigation", { name });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

describe("AccountNav", () => {
  it("shows member sections and one Developers link", () => {
    path.current = "/account/billing";
    render(<AccountNav />);

    expect(links("Account sections")).toEqual([
      "Profile",
      "Notifications",
      "Security",
      "Billing",
      "Developers",
    ]);
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation", { name: "Developer sections" })).toBeNull();
  });

  it("lists the developer sections only on a developer page", () => {
    path.current = "/account/agents";
    render(<AccountNav />);

    expect(links("Developer sections")).toEqual(["API tokens", "Agents", "Connected apps"]);
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
  });
});
