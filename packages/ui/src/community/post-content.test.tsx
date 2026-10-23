import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PostDocument } from "./content";
import { PostContent } from "./post-content";

function doc(content: unknown[]): PostDocument {
  return JSON.parse(JSON.stringify({ type: "doc", content })) as PostDocument;
}

describe("PostContent", () => {
  it("renders paragraphs, marks, lists, and mention chips", () => {
    render(
      <PostContent
        document={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "bold", marks: ["bold"] },
              { type: "text", text: "slanted", marks: ["italic"] },
              { type: "mention", userId: "u1", label: "Ana" },
            ],
          },
          { type: "bulletList", items: [[{ type: "text", text: "first" }]] },
        ])}
      />,
    );

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("slanted").tagName).toBe("EM");
    expect(screen.getByText("@Ana")).toHaveProperty("dataset.userId", "u1");
    expect(screen.getByRole("listitem").textContent).toBe("first");
  });

  it("renders safe links with noopener and nofollow", () => {
    render(
      <PostContent
        document={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "docs", marks: ["link"], href: "https://example.com/a" },
            ],
          },
        ])}
      />,
    );

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/a");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("nofollow");
  });

  it("drops javascript and data hrefs but keeps the text", () => {
    const markup = renderToStaticMarkup(
      <PostContent
        document={doc([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "click", marks: ["link"], href: "javascript:alert(1)" },
              { type: "text", text: "data", marks: ["link"], href: "data:text/html,hi" },
              { type: "text", text: "spaced", marks: ["link"], href: " JaVaScRiPt:alert(1)" },
            ],
          },
        ])}
      />,
    );

    expect(markup).not.toContain("<a");
    expect(markup.toLowerCase()).not.toContain("javascript:");
    expect(markup).toContain("click");
  });

  it("ignores unknown block and inline types", () => {
    const markup = renderToStaticMarkup(
      <PostContent
        document={doc([
          { type: "script", content: "alert(1)" },
          { type: "html", html: "<img src=x onerror=alert(1)>" },
          {
            type: "paragraph",
            content: [
              { type: "raw", text: "nope" },
              { type: "text", text: "ok" },
            ],
          },
        ])}
      />,
    );

    expect(markup).not.toContain("alert");
    expect(markup).not.toContain("nope");
    expect(markup).toContain("ok");
  });

  it("lays out images in a grid with alt text and drops unsafe sources", () => {
    render(
      <PostContent
        document={doc([
          { type: "image", key: "a", url: "https://cdn.test/a.png", alt: "A sunset" },
          { type: "image", key: "b", url: "https://cdn.test/b.png" },
          { type: "image", key: "c", url: "javascript:alert(1)" },
        ])}
      />,
    );

    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(["A sunset", "Image 2 of 2"]);
  });

  it("caps an image grid at 10 images", () => {
    const images = Array.from({ length: 12 }, (_, index) => ({
      type: "image",
      key: `k${index}`,
      url: `https://cdn.test/${index}.png`,
    }));
    render(<PostContent document={doc(images)} />);

    expect(screen.getAllByRole("img")).toHaveLength(10);
  });

  it("loads an embed only after a click", () => {
    render(
      <PostContent
        document={doc([
          { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
        ])}
      />,
    );

    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load YouTube video" }));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("shows the YouTube poster behind the play button before the video loads", () => {
    render(
      <PostContent
        document={doc([
          { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
        ])}
      />,
    );

    const placeholder = screen.getByRole("button", { name: "Load YouTube video" });
    expect(placeholder.textContent).toBe("Load YouTube video");
    expect(placeholder.querySelector("img")?.getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    );
  });

  it("renders a lone ## line as an h3 only where headings are on", () => {
    const content = [
      { type: "paragraph", content: [{ type: "text", text: "## Who it is for" }] },
      { type: "paragraph", content: [{ type: "text", text: "## Two\nlines" }] },
    ];
    render(<PostContent headings document={doc(content)} />);

    expect(screen.getByRole("heading", { level: 3, name: "Who it is for" })).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    cleanup();

    render(<PostContent document={doc(content)} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("## Who it is for")).toBeTruthy();
  });

  it("skips embeds whose provider does not match the URL", () => {
    const markup = renderToStaticMarkup(
      <PostContent
        document={doc([{ type: "embed", provider: "vimeo", url: "https://youtu.be/dQw4w9WgXcQ" }])}
      />,
    );

    expect(markup).not.toContain("button");
  });

  it("renders only paragraphs in the inline variant", () => {
    render(
      <PostContent
        variant="inline"
        document={doc([
          { type: "paragraph", content: [{ type: "text", text: "kept" }] },
          { type: "bulletList", items: [[{ type: "text", text: "list" }]] },
          { type: "image", key: "a", url: "https://cdn.test/a.png" },
          { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
        ])}
      />,
    );

    expect(screen.getByText("kept")).toBeTruthy();
    expect(screen.queryByText("list")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
