import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PosterImage } from "./poster-image";

const sources = ["https://img.test/max.jpg", "https://img.test/sd.jpg", "https://img.test/hq.jpg"];

function image(): HTMLImageElement {
  const found = document.querySelector("img");
  if (!found) throw new Error("no poster image");
  return found;
}

describe("PosterImage", () => {
  it("starts with the sharpest source", () => {
    render(<PosterImage sources={sources} />);
    expect(image().getAttribute("src")).toBe(sources[0]);
    expect(image().getAttribute("alt")).toBe("");
  });

  it("falls back to the next source when one fails to load", () => {
    render(<PosterImage sources={sources} />);
    fireEvent.error(image());
    expect(image().getAttribute("src")).toBe(sources[1]);
  });

  it("treats YouTube's tiny missing-poster placeholder as a failure", () => {
    render(<PosterImage sources={sources} />);
    Object.defineProperty(image(), "naturalWidth", { configurable: true, value: 120 });
    fireEvent.load(image());
    expect(image().getAttribute("src")).toBe(sources[1]);
  });

  it("keeps a source that loaded at full size", () => {
    render(<PosterImage sources={sources} />);
    Object.defineProperty(image(), "naturalWidth", { configurable: true, value: 1280 });
    fireEvent.load(image());
    expect(image().getAttribute("src")).toBe(sources[0]);
  });

  it("renders nothing once every source failed", () => {
    render(<PosterImage sources={sources.slice(0, 1)} />);
    fireEvent.error(image());
    expect(document.querySelector("img")).toBeNull();
  });
});
