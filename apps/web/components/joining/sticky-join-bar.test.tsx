import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StickyJoinBar } from "./sticky-join-bar";

type Callback = (entries: Pick<IntersectionObserverEntry, "target" | "isIntersecting">[]) => void;

let report: Callback = () => {};

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function renderBar(aboveTabs = false) {
  const hero = document.createElement("div");
  hero.id = "join";
  const closing = document.createElement("section");
  closing.id = "about-closing";
  document.body.append(hero, closing);
  render(
    <StickyJoinBar name="Makers" price="$10.00/month" aboveTabs={aboveTabs}>
      <button type="button">Join for $10.00/month</button>
    </StickyJoinBar>,
  );
  return { hero, closing };
}

function bar(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="sticky-join"]');
  if (!element) throw new Error("sticky join bar missing");
  return element;
}

describe("StickyJoinBar", () => {
  it("stays hidden while the hero join button is on screen", () => {
    const { hero, closing } = renderBar();

    act(() =>
      report([
        { target: hero, isIntersecting: true },
        { target: closing, isIntersecting: false },
      ]),
    );

    expect(bar().hidden).toBe(true);
  });

  it("appears with the price once the hero join button scrolls away", () => {
    const { hero, closing } = renderBar();

    act(() =>
      report([
        { target: hero, isIntersecting: false },
        { target: closing, isIntersecting: false },
      ]),
    );

    expect(bar().hidden).toBe(false);
    expect(screen.getByRole("complementary", { name: "Join Makers" })).toBe(bar());
    expect(screen.getByText("$10.00/month · Cancel anytime")).toBeDefined();
  });

  it("hides again when the closing call to action reaches the screen", () => {
    const { hero, closing } = renderBar();
    act(() =>
      report([
        { target: hero, isIntersecting: false },
        { target: closing, isIntersecting: false },
      ]),
    );

    act(() => report([{ target: closing, isIntersecting: true }]));

    expect(bar().hidden).toBe(true);
  });

  it("sits above the bottom tab bar on phones when the community shows tabs", () => {
    renderBar(true);

    expect(bar().className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(bar().className).toContain("lg:hidden");
  });
});
