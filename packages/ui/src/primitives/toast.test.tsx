import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { toast, Toaster } from "./toast";

describe("Toaster", () => {
  it("keeps toasts above the phone tab bar by offsetting them from the bottom", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast("Posted.");
    });
    await screen.findByText("Posted.");

    const list = container.ownerDocument.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(list?.style.getPropertyValue("--mobile-offset-bottom")).toBe(
      "var(--toast-offset-bottom)",
    );
    expect(list?.style.getPropertyValue("--offset-bottom")).toBe("var(--toast-offset-bottom)");
  });
});
