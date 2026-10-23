import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataExportPanel } from "./data-export-panel";

vi.mock("./data-export-actions", () => ({ requestDataExport: vi.fn() }));

describe("DataExportPanel", () => {
  it("links the copy that is ready, so a lost email does not lose it", () => {
    render(
      <DataExportPanel
        privacyHref="/privacy"
        ready={{ href: "/account/data-export/export-1", expiresOn: "29 October 2026" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Download your copy" }).getAttribute("href")).toBe(
      "/account/data-export/export-1",
    );
    expect(screen.getByText(/works until 29 October 2026/)).toBeTruthy();
  });

  it("shows no download link when no copy is ready", () => {
    render(<DataExportPanel privacyHref="/privacy" ready={null} />);

    expect(screen.queryByRole("link", { name: "Download your copy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download your data" })).toBeTruthy();
  });
});
