import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VisitorHeroData } from "../../lib/communities/about";
import { VisitorHero } from "./visitor-hero";

vi.mock("../joining/join-panel", () => ({ JoinPanel: () => null }));

function hero(coverUrl: string | null): VisitorHeroData {
  return {
    slug: "makers",
    name: "Makers Guild",
    description: null,
    coverUrl,
    privacy: "public",
    memberCount: 12,
    owner: null,
    rating: null,
    joinState: { kind: "join" },
    offer: { price: null, note: null },
    hasHost: false,
    nextEvent: null,
  };
}

describe("VisitorHero", () => {
  it("shows the cover at 3:1 on phones and 4:1 from 768px across the hero width", () => {
    const { container } = render(<VisitorHero hero={hero("/api/uploads/cover.png")} />);

    const cover = container.querySelector('[data-slot="community-cover"]');
    expect(cover?.tagName).toBe("IMG");
    expect(cover?.getAttribute("src")).toBe("/api/uploads/cover.png");
    expect(cover?.className).toContain("aspect-[3/1]");
    expect(cover?.className).toContain("md:aspect-[4/1]");
    expect(cover?.className).toContain("w-full");
    expect(cover?.className).toContain("object-cover");
  });

  it("loads the cover first because it is the largest image above the fold", () => {
    const { container } = render(<VisitorHero hero={hero("/api/uploads/cover.png")} />);

    const cover = container.querySelector('[data-slot="community-cover"]');
    expect(cover?.getAttribute("fetchpriority")).toBe("high");
    expect(cover?.getAttribute("decoding")).toBe("async");
    expect(cover?.getAttribute("loading")).toBeNull();
  });

  it("lets a phone load a resized cover through srcset", () => {
    const { container } = render(<VisitorHero hero={hero("/api/uploads/c/cover.sized.png")} />);

    const cover = container.querySelector('[data-slot="community-cover"]');
    expect(cover?.getAttribute("srcset")).toContain("/api/uploads/c/cover.w640.webp 640w");
    expect(cover?.getAttribute("sizes")).toBe("(min-width: 1024px) 992px, 100vw");
  });

  it("renders no cover and no letter tile without a cover", () => {
    const { container } = render(<VisitorHero hero={hero(null)} />);

    expect(container.querySelector('[data-slot="community-cover"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"].bg-accent-muted')).toBeNull();
  });

  it("links the owner line to the host block when the creator wrote one", () => {
    const { getByRole } = render(
      <VisitorHero hero={{ ...hero(null), owner: { name: "Riza", image: null }, hasHost: true }} />,
    );

    expect(getByRole("link", { name: "By Riza" }).getAttribute("href")).toBe("#host");
  });

  it("keeps the owner line plain without a host block", () => {
    const { queryByRole, getByText } = render(
      <VisitorHero hero={{ ...hero(null), owner: { name: "Riza", image: null } }} />,
    );

    expect(getByText("By Riza")).toBeDefined();
    expect(queryByRole("link", { name: "By Riza" })).toBeNull();
  });

  it("shows the next real event under the meta line", () => {
    const { getByText } = render(
      <VisitorHero hero={{ ...hero(null), nextEvent: "Next event: Tue 27 Oct" }} />,
    );

    expect(getByText("Next event: Tue 27 Oct").tagName).toBe("P");
  });
});
