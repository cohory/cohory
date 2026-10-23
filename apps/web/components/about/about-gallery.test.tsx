import type { GalleryItemView } from "@cohory/communities";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AboutGallery } from "./about-gallery";

const youtube: GalleryItemView = {
  id: "v",
  kind: "video_embed",
  provider: "youtube",
  url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  altText: null,
  position: 0,
};
const image: GalleryItemView = {
  id: "i",
  kind: "image",
  url: "/a.png",
  altText: "Desk",
  position: 2,
};

const items: GalleryItemView[] = [
  youtube,
  {
    id: "l",
    kind: "video_embed",
    provider: "vimeo",
    url: "https://player.vimeo.com/video/76979871",
    thumbnailUrl: null,
    altText: null,
    position: 1,
  },
  image,
];

function player(): HTMLIFrameElement | null {
  return document.querySelector("iframe");
}

describe("AboutGallery", () => {
  it("renders the poster on the server so hydration matches", () => {
    const html = renderToString(<AboutGallery items={items} />);
    expect(html).toContain(`data-slot="gallery-poster"`);
    expect(html).not.toContain("<iframe");
  });

  it("shows the hero video poster with a play button and loads no player after mount", () => {
    render(<AboutGallery items={items} />);

    expect(player()).toBeNull();
    expect(document.querySelector('[data-slot="gallery-poster"] img')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play YouTube video" })).toBeTruthy();
  });

  it("plays the hero video only after the visitor clicks play", () => {
    render(<AboutGallery items={items} />);

    fireEvent.click(screen.getByRole("button", { name: "Play YouTube video" }));

    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(player()?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1",
    );
    expect(player()?.getAttribute("allow")).toContain("autoplay");
  });

  it("shows the poster for a selected video and loads no player until play is clicked", () => {
    render(<AboutGallery items={items} />);

    fireEvent.click(screen.getByRole("button", { name: "Vimeo video 2 of 3" }));

    expect(player()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play Vimeo video" }));
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(player()?.getAttribute("src")).toContain("https://player.vimeo.com/video/76979871?");
  });

  it("shows the provider on the chip and keeps the visible text inside the accessible name", () => {
    render(<AboutGallery items={[{ ...youtube, altText: "Welcome tour, 3 minutes" }]} />);

    const play = screen.getByRole("button", {
      name: "Play YouTube video: Welcome tour, 3 minutes",
    });
    expect(play.textContent).toBe("Play YouTube video");
  });

  it("uses the sharpest YouTube poster, whatever thumbnail was stored", () => {
    render(<AboutGallery items={items} />);

    expect(document.querySelector('[data-slot="gallery-poster"] img')?.getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    );
  });

  it("moves with previous and next buttons, wraps around, and counts the position", () => {
    render(<AboutGallery items={items} />);

    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Desk" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next item" }));
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("announces the item after each step in a polite status region", () => {
    render(<AboutGallery items={items} />);
    const status = screen.getByRole("status");

    expect(status.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
    expect(status.textContent).toBe("Image 3 of 3: Desk");
  });

  it("follows a swipe on the hero", () => {
    render(<AboutGallery items={items} />);
    const hero = document.querySelector('[data-slot="gallery-hero"]');
    if (!hero) throw new Error("no hero");

    fireEvent.touchStart(hero, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(hero, { changedTouches: [{ clientX: 120, clientY: 110 }] });
    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.touchStart(hero, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(hero, { changedTouches: [{ clientX: 300, clientY: 100 }] });
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("ignores a vertical scroll over the hero", () => {
    render(<AboutGallery items={items} />);
    const hero = document.querySelector('[data-slot="gallery-hero"]');
    if (!hero) throw new Error("no hero");

    fireEvent.touchStart(hero, { touches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchEnd(hero, { changedTouches: [{ clientX: 140, clientY: 100 }] });
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("moves between thumbnails with the arrow keys and keeps one tab stop", () => {
    render(<AboutGallery items={items} />);
    const first = screen.getByRole("button", { name: "YouTube video 1 of 3" });
    const second = screen.getByRole("button", { name: "Vimeo video 2 of 3" });
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Image 3 of 3: Desk" }));
    fireEvent.keyDown(document.activeElement ?? second, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("opens an image full screen on tap", () => {
    render(<AboutGallery items={[image]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open full screen: Desk" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/a.png");
  });

  it("serves resized images with srcset to the hero and the thumbnails", () => {
    const resized: GalleryItemView = { ...image, url: "/api/uploads/g/x.sized.jpg" };
    render(<AboutGallery items={[resized, youtube]} />);

    const hero = screen.getByRole("img", { name: "Desk" });
    expect(hero.getAttribute("srcset")).toContain("/api/uploads/g/x.w1280.webp 1280w");
    expect(hero.getAttribute("sizes")).toBeTruthy();
    const thumbnail = screen
      .getByRole("button", { name: "Image 1 of 2: Desk" })
      .querySelector("img");
    expect(thumbnail?.getAttribute("srcset")).toContain("/api/uploads/g/x.w160.webp 160w");
    expect(thumbnail?.getAttribute("sizes")).toBe("96px");
  });

  it("keeps a plain src for images uploaded before resizing existed", () => {
    render(<AboutGallery items={[image]} />);

    expect(screen.getByRole("img", { name: "Desk" }).getAttribute("srcset")).toBeNull();
  });

  it("wraps the thumbnails to more rows on wide screens instead of hiding them", () => {
    render(<AboutGallery items={items} />);

    expect(screen.getByRole("list", { name: "Gallery items" }).className).toContain("md:flex-wrap");
  });
});
