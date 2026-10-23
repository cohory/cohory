import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformBrand } from "./platform-brand";

const cohory = { name: "Cohory", logoUrl: null };

describe("PlatformBrand", () => {
  it("links the Cohory icon and wordmark home outside a community", () => {
    const { container } = render(<PlatformBrand community={null} instance={cohory} />);

    const link = screen.getByRole("link", { name: "Cohory" });
    expect(link.getAttribute("href")).toBe("/");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the operator's instance name and logo instead of Cohory", () => {
    const { container } = render(
      <PlatformBrand
        community={null}
        instance={{ name: "Acme Academy", logoUrl: "/brand/acme.svg" }}
      />,
    );

    const link = screen.getByRole("link", { name: "Acme Academy" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("/brand/acme.svg");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Cohory")).toBeNull();
  });

  it("shows the community logo and name linking to the feed inside a community", () => {
    render(
      <PlatformBrand
        community={{ slug: "makers", name: "Makers Guild", logoUrl: "https://cdn.test/logo.png" }}
        instance={cohory}
      />,
    );

    const link = screen.getByRole("link", { name: "Makers Guild" });
    expect(link.getAttribute("href")).toBe("/c/makers");
    expect(link.querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/logo.png");
    expect(screen.queryByText("Cohory")).toBeNull();
  });

  it("falls back to an initial when the community has no logo", () => {
    render(
      <PlatformBrand
        community={{ slug: "writers", name: "Writers Room", logoUrl: null }}
        instance={cohory}
      />,
    );

    const link = screen.getByRole("link", { name: "Writers Room" });
    expect(link.querySelector("img")).toBeNull();
    expect(screen.getByText("W").getAttribute("aria-hidden")).toBe("true");
  });
});
