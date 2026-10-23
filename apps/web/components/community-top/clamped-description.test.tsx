import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClampedDescription } from "./clamped-description";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(120);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(72);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ClampedDescription", () => {
  it("lays the more button over the last line so nothing below moves when it appears", () => {
    render(<ClampedDescription name="Dev" text="A long description" />);

    const more = screen.getByRole("button", { name: /^more\s*about Dev$/ });
    expect(more.className).toContain("absolute");
    expect(more.className).toContain("bottom-0");
  });

  it("offers the join control inside the more dialog", async () => {
    render(
      <ClampedDescription
        name="Dev"
        text="A long description"
        join={<button type="button">Join community</button>}
      />,
    );

    screen.getByRole("button", { name: /^more\s*about Dev$/ }).click();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Join community" })).toBeDefined();
  });
});
