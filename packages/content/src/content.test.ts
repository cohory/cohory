import { describe, expect, it } from "vitest";

import {
  collectImages,
  collectMentions,
  collectUsernameMentions,
  ContentValidationError,
  extractExcerpt,
  extractPlainText,
  linkUsernameMentions,
  maxContentTextLength,
  parseContent,
  renderContentHtml,
  replaceUnresolvedMentions,
  type ContentDocument,
} from "./index";

const mentionId = "0192f0a0-0000-7000-8000-0000000000aa";
const otherId = "0192f0a0-0000-7000-8000-0000000000bb";

function doc(...content: unknown[]): unknown {
  return { type: "doc", content };
}

function paragraph(...content: unknown[]): unknown {
  return { type: "paragraph", content };
}

function text(value: string, marks?: unknown[]): unknown {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function parsePost(input: unknown): ContentDocument {
  return parseContent(input, { allowImages: true });
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContentValidationError) {
      return error.issues.map((issue) => issue.message);
    }
    throw error;
  }
  throw new Error("expected a ContentValidationError");
}

describe("parseContent", () => {
  it("accepts paragraphs, marks, lists, quotes, code, mentions, embeds, and images", () => {
    const input = doc(
      paragraph(
        text("Hello "),
        text("bold", [{ type: "bold" }, { type: "italic" }]),
        { type: "hardBreak" },
        text("site", [{ type: "link", attrs: { href: "https://example.com/a?b=1" } }]),
        { type: "mention", attrs: { id: mentionId, label: "Ada" } },
      ),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("one"))] }],
      },
      {
        type: "orderedList",
        content: [{ type: "listItem", content: [paragraph(text("two"))] }],
      },
      { type: "blockquote", content: [paragraph(text("quoted"))] },
      { type: "codeBlock", content: [text("const a = 1;")] },
      { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc" } },
      { type: "image", attrs: { key: "communities/x/posts/a.png", width: 10, height: 20 } },
    );

    expect(parsePost(input)).toEqual(input);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["  javascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:msgbox(1)"],
    ["//evil.example"],
    ["not a url"],
  ])("rejects the link href %s", (href) => {
    const input = doc(paragraph(text("x", [{ type: "link", attrs: { href } }])));

    expect(issuesOf(() => parsePost(input)).length).toBeGreaterThan(0);
  });

  it("rejects unknown attributes such as event handlers", () => {
    const input = doc({
      type: "image",
      attrs: { key: "communities/x/posts/a.png", onerror: "alert(1)" },
    });

    expect(() => parsePost(input)).toThrow(ContentValidationError);
  });

  it("rejects unknown node types and raw html nodes", () => {
    expect(() => parsePost(doc({ type: "html", html: "<script>alert(1)</script>" }))).toThrow(
      ContentValidationError,
    );
    expect(() => parsePost(doc({ type: "iframe", attrs: { src: "https://x" } }))).toThrow(
      ContentValidationError,
    );
  });

  it.each([
    "https://evil.example/watch?v=1",
    "https://youtube.com.evil.example/x",
    "http://www.youtube.com/watch?v=1",
    "javascript:alert(1)//youtube.com",
  ])("rejects the embed url %s", (url) => {
    expect(() => parsePost(doc({ type: "embed", attrs: { url } }))).toThrow(ContentValidationError);
  });

  it.each([
    "https://youtu.be/abc",
    "https://vimeo.com/123",
    "https://player.vimeo.com/video/123",
    "https://www.loom.com/share/abc",
    "https://fast.wistia.net/embed/iframe/abc",
    "https://acme.wistia.com/medias/abc",
  ])("accepts the embed url %s", (url) => {
    expect(() => parsePost(doc({ type: "embed", attrs: { url } }))).not.toThrow();
  });

  it(`rejects more than ${maxContentTextLength} characters of text`, () => {
    const input = doc(paragraph(text("a".repeat(maxContentTextLength + 1))));

    expect(issuesOf(() => parsePost(input))).toContain(
      `The text is longer than ${maxContentTextLength} characters.`,
    );
  });

  it("accepts exactly the maximum text length", () => {
    expect(() => parsePost(doc(paragraph(text("a".repeat(maxContentTextLength)))))).not.toThrow();
  });

  it("rejects more than 10 images", () => {
    const images = Array.from({ length: 11 }, (_, i) => ({
      type: "image",
      attrs: { key: `communities/x/posts/${i}.png` },
    }));

    expect(issuesOf(() => parsePost(doc(...images)))).toContain("A post can have up to 10 images.");
  });

  it("rejects images where they are not allowed", () => {
    const input = doc({ type: "image", attrs: { key: "communities/x/posts/a.png" } });

    expect(() => parseContent(input, { allowImages: false })).toThrow(ContentValidationError);
  });

  it("rejects an empty document", () => {
    expect(() => parsePost(doc(paragraph(text("   "))))).toThrow(ContentValidationError);
    expect(() => parsePost(doc())).toThrow(ContentValidationError);
  });

  it("rejects deeply nested documents without overflowing the stack", () => {
    let node: unknown = paragraph(text("deep"));
    for (let i = 0; i < 20_000; i += 1) {
      node = { type: "blockquote", content: [node] };
    }

    expect(() => parsePost(doc(node))).toThrow(ContentValidationError);
  });

  it("rejects duplicate marks on one text node", () => {
    const input = doc(paragraph(text("x", [{ type: "bold" }, { type: "bold" }])));

    expect(() => parsePost(input)).toThrow(ContentValidationError);
  });

  it("rejects input that is not a document", () => {
    expect(() => parsePost("<p>hi</p>")).toThrow(ContentValidationError);
    expect(() => parsePost(null)).toThrow(ContentValidationError);
  });
});

describe("renderContentHtml", () => {
  it("escapes text so markup in content is shown, not executed", () => {
    const html = renderContentHtml(
      parsePost(doc(paragraph(text(`<script>alert("x")</script><img src=x onerror=alert(1)>`)))),
    );

    expect(html).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</p>",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("renders links with rel noopener and nofollow and escapes the href", () => {
    const html = renderContentHtml(
      parsePost(
        doc(
          paragraph(
            text("site", [{ type: "link", attrs: { href: `https://example.com/?q="><script>` } }]),
          ),
        ),
      ),
    );

    expect(html).toBe(
      '<p><a href="https://example.com/?q=%22%3E%3Cscript%3E" rel="noopener noreferrer nofollow ugc" target="_blank">site</a></p>',
    );
  });

  it("drops a link whose href is not http, https, or mailto even if validation was bypassed", () => {
    const forged = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    } as ContentDocument;

    expect(renderContentHtml(forged)).toBe("<p>click</p>");
  });

  it("nests marks in a stable order regardless of input order", () => {
    const a = renderContentHtml(
      parsePost(doc(paragraph(text("x", [{ type: "italic" }, { type: "bold" }])))),
    );
    const b = renderContentHtml(
      parsePost(doc(paragraph(text("x", [{ type: "bold" }, { type: "italic" }])))),
    );

    expect(a).toBe("<p><strong><em>x</em></strong></p>");
    expect(b).toBe(a);
  });

  it("renders embeds as placeholder elements, never iframes", () => {
    const html = renderContentHtml(
      parsePost(doc({ type: "embed", attrs: { url: "https://youtu.be/abc" } })),
    );

    expect(html).toBe(
      '<div data-embed="" data-embed-provider="youtube" data-embed-url="https://youtu.be/abc"><a href="https://youtu.be/abc" rel="noopener noreferrer nofollow ugc" target="_blank">https://youtu.be/abc</a></div>',
    );
    expect(html).not.toContain("<iframe");
  });

  it("renders mentions, lists, quotes, code, breaks, and images", () => {
    const html = renderContentHtml(
      parsePost(
        doc(
          paragraph(
            { type: "mention", attrs: { id: mentionId, label: "Ada <3" } },
            { type: "hardBreak" },
          ),
          { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("a"))] }] },
          { type: "blockquote", content: [paragraph(text("q"))] },
          { type: "codeBlock", content: [text("<b>")] },
          { type: "image", attrs: { key: "communities/x/posts/a.png", width: 4, height: 3 } },
        ),
      ),
      { imageUrl: (key) => `/files/${key}` },
    );

    expect(html).toBe(
      `<p><span data-mention-id="${mentionId}">@Ada &lt;3</span><br></p>` +
        "<ul><li><p>a</p></li></ul>" +
        "<blockquote><p>q</p></blockquote>" +
        "<pre><code>&lt;b&gt;</code></pre>" +
        '<figure data-image-key="communities/x/posts/a.png"><img src="/files/communities/x/posts/a.png" alt="" width="4" height="3" loading="lazy"></figure>',
    );
  });
});

describe("plain text and excerpts", () => {
  const sample = parsePost(
    doc(
      paragraph(text("Hello "), { type: "mention", attrs: { id: mentionId, label: "Ada" } }),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("item"))] }] },
      { type: "embed", attrs: { url: "https://vimeo.com/1" } },
    ),
  );

  it("extracts plain text with one line per block", () => {
    expect(extractPlainText(sample)).toBe("Hello @Ada\nitem\nhttps://vimeo.com/1");
  });

  it("collapses whitespace in the excerpt", () => {
    expect(extractExcerpt(sample)).toBe("Hello @Ada item https://vimeo.com/1");
  });

  it("cuts the excerpt to at most 280 characters on a word boundary", () => {
    const long = parsePost(doc(paragraph(text("word ".repeat(200)))));
    const excerpt = extractExcerpt(long);

    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("wor…");
  });
});

describe("mentions", () => {
  const input = parsePost(
    doc(
      paragraph(
        { type: "mention", attrs: { id: mentionId, label: "Ada" } },
        { type: "mention", attrs: { id: otherId, label: "Ghost" } },
        { type: "mention", attrs: { id: mentionId, label: "Ada" } },
      ),
      {
        type: "blockquote",
        content: [paragraph({ type: "mention", attrs: { id: otherId, label: "Ghost" } })],
      },
    ),
  );

  it("collects unique mentioned ids in document order", () => {
    expect(collectMentions(input)).toEqual([mentionId, otherId]);
  });

  it("turns unresolved mentions into plain text", () => {
    const resolved = replaceUnresolvedMentions(input, new Set([mentionId]));

    expect(collectMentions(resolved)).toEqual([mentionId]);
    expect(extractPlainText(resolved)).toBe("@Ada@Ghost@Ada\n@Ghost");
  });
});

describe("collectImages", () => {
  it("returns image references in document order", () => {
    const input = parsePost(
      doc(
        { type: "image", attrs: { key: "communities/x/posts/b.png" } },
        paragraph(text("between")),
        { type: "image", attrs: { key: "communities/x/posts/a.png", width: 2, height: 1 } },
      ),
    );

    expect(collectImages(input)).toEqual([
      { key: "communities/x/posts/b.png", width: null, height: null },
      { key: "communities/x/posts/a.png", width: 2, height: 1 },
    ]);
  });
});

describe("username mentions", () => {
  const ada = { userId: "0192f0a0-0000-7000-8000-0000000000aa", username: "ada" };

  it("collects candidates from paragraphs but not from code blocks, code marks, or links", () => {
    const doc = parseContent(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hi @Ada-L and @x and a@b" }] },
          { type: "codeBlock", content: [{ type: "text", text: "@grace" }] },
          {
            type: "paragraph",
            content: [{ type: "text", text: "@linus", marks: [{ type: "code" }] }],
          },
        ],
      },
      { allowImages: false },
    );

    expect(collectUsernameMentions(doc)).toEqual(["ada-l"]);
  });

  it("splits text into mention nodes for known usernames and keeps marks on the rest", () => {
    const doc = parseContent(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "@ada, thanks", marks: [{ type: "bold" }] }],
          },
        ],
      },
      { allowImages: false },
    );

    expect(linkUsernameMentions(doc, new Map([["ada", ada]])).content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "mention", attrs: { id: ada.userId, label: "ada" } },
        { type: "text", text: ", thanks", marks: [{ type: "bold" }] },
      ],
    });
  });
});

describe("invisible characters", () => {
  it("are removed from post and comment text before it is stored", () => {
    const doc = parseContent(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hel\u200Blo\u{E0041}\u202E" }] },
        ],
      },
      { allowImages: false },
    );
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Hello" }],
    });
  });
});
