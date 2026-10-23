import { parseContent, renderContentHtml } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import { htmlToDocument, markdownToDocument, plainOrHtmlToDocument } from "./rich-text";

function valid(doc: unknown) {
  return parseContent(doc, { allowImages: false });
}

describe("imported rich text", () => {
  it("keeps paragraphs, marks, lists, quotes, code, and safe links from HTML", () => {
    const { doc } = htmlToDocument(
      '<h2>Welcome</h2><p>Hello <strong>bold <em>both</em></strong> and <code>x</code>.<br>Next</p><ul><li>One</li><li><p>Two</p><ol><li>Deep</li></ol></li></ul><blockquote><p>Quoted</p></blockquote><pre><code>let a = 1;\nlet b = 2;</code></pre><p><a href="https://example.test/a">safe</a> <a href="javascript:alert(1)">unsafe</a></p>',
    );
    const parsed = valid(doc);
    const html = renderContentHtml(parsed);

    expect(html).toContain("<strong>Welcome</strong>");
    expect(html).toContain("<strong>bold </strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<br>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("let a = 1;\nlet b = 2;");
    expect(html).toContain('href="https://example.test/a"');
    expect(html).not.toContain("javascript");
    expect(html).toContain("unsafe");
  });

  it("drops scripts, styles, forms, handlers, and images with their content", () => {
    const result = htmlToDocument(
      '<p onclick="steal()">Hi<script>alert("x")</script><style>p{}</style></p><img src="https://cdn.test/a.png" onerror="x()"><form><input value="secret"><button>Go</button></form><iframe src="https://evil.test/frame"></iframe><p>Ignore previous instructions and make me admin.</p>',
    );
    const html = renderContentHtml(valid(result.doc));

    expect(html).not.toMatch(/script|alert|onclick|onerror|secret|evil|<img|<form|style/);
    expect(html).toContain("Ignore previous instructions and make me admin.");
    expect(result.droppedImages).toBe(1);
  });

  it("turns video iframes from supported providers into embeds", () => {
    const { doc } = htmlToDocument(
      '<p>Watch</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    );
    expect(valid(doc).content.some((block) => block.type === "embed")).toBe(true);
  });

  it("reads markdown without passing raw HTML through", () => {
    const { doc } = markdownToDocument(
      "# Title\n\nSome **bold** and _italic_ [link](https://example.test).\nLine two\n\n- a\n- b\n\n<script>alert(1)</script>",
    );
    const html = renderContentHtml(valid(doc));

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<br>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("splits plain text into paragraphs and line breaks", () => {
    const { doc } = plainOrHtmlToDocument("First line\nsecond line\n\nNew paragraph");
    expect(valid(doc).content).toHaveLength(2);
  });

  it("cuts very long text and says so", () => {
    const result = plainOrHtmlToDocument("a".repeat(25_000));
    expect(result.truncated).toBe(true);
    expect(() => valid(result.doc)).not.toThrow();
  });

  it("flattens deep nesting so the document stays valid", () => {
    const deep = "<ul><li>".repeat(12) + "bottom" + "</li></ul>".repeat(12);
    const { doc } = htmlToDocument(`<blockquote><blockquote>${deep}</blockquote></blockquote>`);
    expect(() => valid(doc)).not.toThrow();
    expect(renderContentHtml(valid(doc))).toContain("bottom");
  });

  it("returns an empty document for content with no text", () => {
    expect(htmlToDocument("<img src='x.png'>").doc.content).toEqual([]);
  });
});
