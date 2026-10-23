import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it.each(["sm", "md"] as const)(
    "gives the %s size a 44px hit area around its smaller visual box",
    (size) => {
      render(<Button size={size}>Save bio</Button>);
      const button = screen.getByRole("button", { name: "Save bio" });
      expect(button.className).toContain("relative");
      expect(button.className).toContain("touch-hit");
    },
  );

  it("moves the danger fill toward the text color on hover so its label keeps contrast", () => {
    render(<Button variant="danger">Delete lesson</Button>);
    const className = screen.getByRole("button", { name: "Delete lesson" }).className;
    expect(className).toContain(
      "hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,var(--color-text))]",
    );
    expect(className).not.toMatch(/hover:bg-danger\//);
  });

  it("lets a caller place the button absolutely", () => {
    render(<Button className="absolute">Close</Button>);
    const button = screen.getByRole("button", { name: "Close" });
    expect(button.className).toContain("absolute");
    expect(button.className).not.toMatch(/\brelative\b/);
  });
});
