import { describe, expect, it } from "vitest";

import { composeDocument, composeInline, extractEmbeds, findMentions } from "./compose-document";
import { resolveEmbed } from "./content";

describe("composeDocument", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const document = composeDocument("First line\nsecond line\n\n\nNext paragraph");

    expect(document).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First line\nsecond line" }] },
        { type: "paragraph", content: [{ type: "text", text: "Next paragraph" }] },
      ],
    });
  });

  it("parses bold and italic marks", () => {
    expect(composeInline("a **bold** and *italic* word")).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "bold", marks: ["bold"] },
      { type: "text", text: " and " },
      { type: "text", text: "italic", marks: ["italic"] },
      { type: "text", text: " word" },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(composeInline("**a *very* nice**")).toEqual([
      { type: "text", text: "a ", marks: ["bold"] },
      { type: "text", text: "very", marks: ["bold", "italic"] },
      { type: "text", text: " nice", marks: ["bold"] },
    ]);
  });

  it("leaves unmatched asterisks as text", () => {
    expect(composeInline("2 * 3 = 6 and **open")).toEqual([
      { type: "text", text: "2 * 3 = 6 and **open" },
    ]);
  });

  it("turns bare URLs into links without trailing punctuation", () => {
    expect(composeInline("See https://example.com/docs?a=1.")).toEqual([
      { type: "text", text: "See " },
      {
        type: "text",
        text: "https://example.com/docs?a=1",
        marks: ["link"],
        href: "https://example.com/docs?a=1",
      },
      { type: "text", text: "." },
    ]);
  });

  it("extracts YouTube, Vimeo, and Loom URLs into embed blocks and removes them from text", () => {
    const document = composeDocument(
      "Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nhttps://vimeo.com/76979871 and https://www.loom.com/share/abcdef123456",
    );

    expect(document.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Watch" }] },
      { type: "paragraph", content: [{ type: "text", text: "and" }] },
      { type: "embed", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { type: "embed", provider: "vimeo", url: "https://vimeo.com/76979871" },
      { type: "embed", provider: "loom", url: "https://www.loom.com/share/abcdef123456" },
    ]);
  });

  it("keeps a single embed for the same video linked twice", () => {
    const { embeds } = extractEmbeds("https://youtu.be/dQw4w9WgXcQ https://youtu.be/dQw4w9WgXcQ");

    expect(embeds).toHaveLength(1);
  });

  it("resolves mentions through the caller and leaves unknown names as text", () => {
    const document = composeDocument("Hi @ana and @ghost.", [], [], {
      resolveMention: (name) => (name === "ana" ? { userId: "u1", label: "Ana Lima" } : null),
    });

    expect(document.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hi " },
          { type: "mention", userId: "u1", label: "Ana Lima" },
          { type: "text", text: " and @ghost." },
        ],
      },
    ]);
  });

  it("does not treat email addresses as mentions", () => {
    expect(findMentions("write to me@example.com or @ana")).toEqual(["ana"]);
  });

  it("appends uploaded images after the text", () => {
    const document = composeDocument("Photos", [
      { key: "k1", url: "https://cdn.test/1.png", width: 800, height: 600 },
    ]);

    expect(document.content.at(-1)).toEqual({
      type: "image",
      key: "k1",
      url: "https://cdn.test/1.png",
      width: 800,
      height: 600,
    });
  });

  it("builds bullet lists from dash lines", () => {
    const document = composeDocument("- one\n- **two**");

    expect(document.content).toEqual([
      {
        type: "bulletList",
        items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two", marks: ["bold"] }]],
      },
    ]);
  });

  it("keeps only paragraphs in paragraph mode and leaves embed URLs as links", () => {
    const document = composeDocument("- item\n\nhttps://youtu.be/dQw4w9WgXcQ", [], [], {
      blocks: "paragraphs",
    });

    expect(document.content.map((block) => block.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("returns an empty document for whitespace", () => {
    expect(composeDocument("  \n\n  ").content).toEqual([]);
  });

  it("keeps a heading line in its own block when headings are on", () => {
    const document = composeDocument("## Who it is for\nMakers who ship.\n- one\n- two", [], [], {
      headings: true,
    });

    expect(document.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "## Who it is for" }] },
      { type: "paragraph", content: [{ type: "text", text: "Makers who ship.\n- one\n- two" }] },
    ]);
  });

  it("leaves heading lines inside the paragraph when headings are off", () => {
    const document = composeDocument("## Not a heading\nText");

    expect(document.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "## Not a heading\nText" }] },
    ]);
  });
});

describe("resolveEmbed", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    [
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
    ["https://www.loom.com/share/abcdef123456", "https://www.loom.com/embed/abcdef123456"],
  ])("maps %s to an allowlisted player", (url, src) => {
    expect(resolveEmbed(url)?.src).toBe(src);
  });

  it.each([
    "http://youtu.be/dQw4w9WgXcQ",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/channels",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(resolveEmbed(url)).toBeNull();
  });
});
