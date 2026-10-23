import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { unsavedChangesMessage, useUnsavedChanges } from "./use-unsaved-changes";

afterEach(() => {
  vi.restoreAllMocks();
});

function Editor({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return (
    <>
      <a href="/c/design/classroom">Classroom</a>
      <a href="/c/design/classroom" target="_blank">
        New tab
      </a>
      <a href="#notes">Notes</a>
    </>
  );
}

function clickResult(name: string, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  screen.getByRole("link", { name }).dispatchEvent(event);
  return event.defaultPrevented;
}

function beforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedChanges", () => {
  it("asks the browser to warn before unloading while there are unsaved changes", () => {
    render(<Editor dirty />);

    expect(beforeUnloadPrevented()).toBe(true);
  });

  it("lets the page unload when nothing changed", () => {
    render(<Editor dirty={false} />);

    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("stops the warning once the changes are saved", () => {
    const { rerender } = render(<Editor dirty />);
    rerender(<Editor dirty={false} />);

    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("keeps the person on the page when they cancel leaving through an in app link", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor dirty />);

    expect(clickResult("Classroom")).toBe(true);
    expect(confirm).toHaveBeenCalledWith(unsavedChangesMessage);
  });

  it("follows the in app link when the person confirms leaving", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reached = vi.fn();
    render(<Editor dirty />);
    screen.getByRole("link", { name: "Classroom" }).addEventListener("click", (event) => {
      reached();
      event.preventDefault();
    });

    fireEvent.click(screen.getByRole("link", { name: "Classroom" }));

    expect(reached).toHaveBeenCalled();
  });

  it("does not ask for links that open elsewhere or stay on the page", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor dirty />);

    expect(clickResult("New tab")).toBe(false);
    expect(clickResult("Notes")).toBe(false);
    expect(clickResult("Classroom", { metaKey: true })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not ask when nothing changed", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<Editor dirty={false} />);

    expect(clickResult("Classroom")).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
