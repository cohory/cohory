import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../primitives/tooltip";
import { ItemActionsMenu, type ItemAction } from "./item-actions";

const noop = () => {};

async function openMenu(actions: ItemAction[]) {
  render(
    <TooltipProvider>
      <ItemActionsMenu actions={actions} label="Actions for Ada" />
    </TooltipProvider>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Ada" }), { key: "Enter" });
  return screen.findByRole("menu");
}

describe("ItemActionsMenu", () => {
  it("separates the danger actions from the ones before them", async () => {
    const menu = await openMenu([
      { id: "admin", label: "Make admin", onSelect: noop },
      { id: "remove", label: "Remove", variant: "danger", onSelect: noop },
      { id: "ban", label: "Ban", variant: "danger", onSelect: noop },
    ]);

    const parts = [...menu.children].map((child) => child.getAttribute("role"));
    expect(parts).toEqual(["menuitem", "separator", "menuitem", "menuitem"]);
  });

  it("adds no separator when every action is a danger action", async () => {
    const menu = await openMenu([
      { id: "remove", label: "Remove", variant: "danger", onSelect: noop },
    ]);

    expect(menu.querySelector('[role="separator"]')).toBeNull();
  });

  it("renders an action with an href as a link so it opens in a new tab", async () => {
    const menu = await openMenu([
      { id: "edit", label: "Edit event", href: "/c/makers/events/demo/edit", onSelect: noop },
    ]);

    const item = screen.getByRole("menuitem", { name: "Edit event" });
    expect(menu.contains(item)).toBe(true);
    expect(item.tagName).toBe("A");
    expect(item.getAttribute("href")).toBe("/c/makers/events/demo/edit");
  });
});
