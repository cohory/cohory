import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

function renderOpenDialog() {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>About this community</DialogTitle>
        <DialogDescription>A long description.</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent", () => {
  it("caps its height at the viewport and scrolls its own content", () => {
    renderOpenDialog();

    const classes = screen.getByRole("dialog").className.split(" ");
    expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("overscroll-contain");
  });

  it("gives the close button a 44px target", () => {
    renderOpenDialog();

    const classes = screen.getByRole("button", { name: "Close" }).className.split(" ");
    expect(classes).toContain("size-11");
  });
});
