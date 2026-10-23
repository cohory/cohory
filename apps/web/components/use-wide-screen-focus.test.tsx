import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWideScreenFocus } from "./use-wide-screen-focus";

function Field() {
  const ref = useWideScreenFocus<HTMLInputElement>();
  return <input ref={ref} aria-label="Title" />;
}

function mockScreen(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: wide, media: query })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWideScreenFocus", () => {
  it("focuses the field on a wide screen with a mouse", () => {
    mockScreen(true);
    render(<Field />);

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
  });

  it("leaves focus alone on a phone so the keyboard does not cover the page", () => {
    mockScreen(false);
    render(<Field />);

    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Title" }));
  });
});
