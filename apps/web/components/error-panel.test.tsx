import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorPanel } from "./error-panel";
import { SupportLinksProvider } from "./support-links";

vi.mock("next/navigation", () => ({ usePathname: () => "/c/makers/classroom" }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function serverError(digest: string): Error {
  return Object.assign(new Error("An error occurred in the Server Components render."), {
    digest,
  });
}

describe("ErrorPanel", () => {
  it("takes the blame and offers to try again", () => {
    const retry = vi.fn();
    render(<ErrorPanel error={serverError("1234")} retry={retry} />);

    expect(screen.getByRole("heading").textContent).toBe("Something went wrong on our side");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("copies the error id and page so the visitor can report it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ErrorPanel error={serverError("abc123")} retry={vi.fn()} />);

    expect(screen.getByText("Error ID: abc123")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Error ID: abc123"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Page: ${location.href}`));
    expect(screen.getByRole("status").textContent).toBe("Error details copied.");
  });

  it("says so when the clipboard is blocked", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<ErrorPanel error={serverError("abc123")} retry={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Couldn't copy. Select the error ID above instead.",
    );
  });

  it("leaves out the error id when there is none", () => {
    render(<ErrorPanel error="boom" retry={vi.fn()} />);

    expect(screen.queryByText(/Error ID/)).toBeNull();
  });

  it("links to the operator's contact and status page when they are set", () => {
    render(
      <SupportLinksProvider
        links={{ contact: "mailto:help@example.com", status: "https://status.example.com" }}
      >
        <ErrorPanel error="boom" retry={vi.fn()} />
      </SupportLinksProvider>,
    );

    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe(
      "mailto:help@example.com",
    );
    expect(screen.getByRole("link", { name: "Service status" }).getAttribute("href")).toBe(
      "https://status.example.com",
    );
  });

  it("offers Send feedback with the failing page next to Contact support", () => {
    render(
      <SupportLinksProvider links={{ contact: "/contact", status: null }}>
        <ErrorPanel error="boom" retry={vi.fn()} />
      </SupportLinksProvider>,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Contact support",
      "Send feedback",
    ]);
    expect(screen.getByRole("link", { name: "Send feedback" }).getAttribute("href")).toBe(
      "/contact?topic=feedback&from=%2Fc%2Fmakers%2Fclassroom",
    );
  });

  it("shows no contact or status link when neither is set", () => {
    render(<ErrorPanel error="boom" retry={vi.fn()} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
