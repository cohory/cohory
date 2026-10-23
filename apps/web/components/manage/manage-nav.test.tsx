import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { manageSections } from "../../lib/manage/sections";
import { ManageNav } from "./manage-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/c/lab/manage/settings/joining" }));

describe("ManageNav", () => {
  it("lists every section without a sideways scroll strip and marks the open one", () => {
    render(<ManageNav slug="lab" sections={manageSections} />);

    const nav = screen.getByRole("navigation", { name: "Manage sections" });
    expect(nav.querySelector(".overflow-x-auto")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(manageSections.length);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows how many items wait in the Inbox", () => {
    render(<ManageNav slug="lab" sections={["inbox", "people"]} counts={{ inbox: 3 }} />);

    expect(screen.getByRole("link", { name: /^Inbox,\s*3\s*waiting$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "People" })).toBeTruthy();
  });
});
