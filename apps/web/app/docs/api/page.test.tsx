import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ApiReferencePage from "./page";

describe("API reference page", () => {
  it("renders the quickstart for this server and every operation from the OpenAPI document", () => {
    render(<ApiReferencePage />);

    const quickstart = screen.getByRole("region", { name: "Quickstart" });
    expect(within(quickstart).getAllByText(/\/api\/v1/).length).toBeGreaterThan(0);
    expect(within(quickstart).getByText(/claude mcp add/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "OpenAPI document" }).getAttribute("href")).toBe(
      "/api/openapi.json",
    );

    const health = document.getElementById("getHealth");
    expect(health?.textContent).toContain("/api/v1/health");
    const reviews = document.getElementById("listReviews");
    expect(reviews?.textContent).toContain("community:read");
    expect(reviews?.textContent).toContain("cursor");
    expect(screen.getByRole("navigation", { name: "API sections" })).toBeTruthy();
  });
});
