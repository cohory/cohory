import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";
import { CommunityMark, CommunitySwitcherItems } from "./community-switcher";

const communities = [
  { slug: "makers", name: "Makers Guild", unread: 3 },
  { slug: "writers", name: "Writers Room" },
];

function renderItems(props: Parameters<typeof CommunitySwitcherItems>[0]) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <CommunitySwitcherItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("CommunitySwitcherItems", () => {
  it("lists Home first, then communities with unread counts, then create", () => {
    renderItems({ communities, currentSlug: "makers" });

    expect(screen.getByRole("group", { name: "Your communities" })).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Home",
      "MMakers Guild3 unread",
      "WWriters Room",
      "Create a community",
    ]);
    expect(items[0]?.getAttribute("href")).toBe("/");
    expect(items[1]?.getAttribute("href")).toBe("/c/makers");
    expect(items[1]?.getAttribute("aria-current")).toBe("page");
    expect(items[2]?.getAttribute("aria-current")).toBeNull();
    expect(items[3]?.getAttribute("href")).toBe("/communities/new");
  });

  it("caps large unread counts at 99+", () => {
    renderItems({ communities: [{ slug: "big", name: "Big", unread: 250 }] });

    expect(screen.getByRole("menuitem", { name: /Big/ }).textContent).toBe("BBig99+ unread");
  });

  it("explains an empty list and still offers Home", () => {
    renderItems({ communities: [] });

    expect(screen.getByText("You haven't joined one yet.")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Home" }).getAttribute("href")).toBe("/");
  });
});

describe("CommunityMark", () => {
  it("shows the logo when there is one", () => {
    const { container } = render(<CommunityMark name="Makers" logoUrl="/logo.png" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
  });

  it("falls back to the first letter of the name", () => {
    render(<CommunityMark name="  writers room" />);

    expect(screen.getByText("W").getAttribute("aria-hidden")).toBe("true");
  });
});
