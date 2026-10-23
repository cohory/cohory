import { describe, expect, it } from "vitest";

import { findBlockedImages, renderLessonHtml, withoutLeadingTitle } from "./markdown";

const options = { imageHosts: ["images.example.com"] };

describe("renderLessonHtml", () => {
  it("renders headings, lists, code, and emphasis", () => {
    const html = renderLessonHtml(
      "# Title\n\n- one\n- two\n\n1. first\n\n`inline` and **bold**\n\n```ts\nconst a = 1 < 2;\n```",
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>\n<li>one</li>");
    expect(html).toContain("<ol>\n<li>first</li>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;\n</code></pre>');
  });

  it("adds noopener and nofollow to links", () => {
    expect(renderLessonHtml("[docs](https://example.com/a)")).toBe(
      '<p><a href="https://example.com/a" rel="noopener noreferrer nofollow" target="_blank">docs</a></p>\n',
    );
  });

  it.each([
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<iframe src="https://evil.test"></iframe>',
    "<div onclick=alert(1)>hi</div>",
    '<a href="javascript:alert(1)">x</a>',
    "<style>body{display:none}</style>",
  ])("escapes raw html %s", (input) => {
    const html = renderLessonHtml(input);

    expect(html).not.toMatch(/<(script|img|iframe|div|style)\b/i);
    expect(html).not.toMatch(/<a [^>]*href="javascript/i);
    expect(html).not.toMatch(/<[^>]* on[a-z]+=/i);
  });

  it.each([
    "[x](javascript:alert(1))",
    "[x](JAVASCRIPT:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](vbscript:msgbox)",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "[x](file:///etc/passwd)",
    "<javascript:alert(1)>",
  ])("drops dangerous link %s", (input) => {
    expect(renderLessonHtml(input)).not.toMatch(/href="\s*(javascript|vbscript|data|file):/i);
  });

  it("does not let attribute values break out", () => {
    const html = renderLessonHtml('[x](https://example.com/" onmouseover="alert(1))');

    expect(html).not.toContain('" onmouseover');
  });

  it("renders images only from allowed hosts or the uploads route", () => {
    const allowed = renderLessonHtml("![chart](https://images.example.com/c.png)", options);
    const upload = renderLessonHtml("![a](/api/uploads/communities/x/courses/y/a.png)", options);
    const blocked = renderLessonHtml("![tracker](https://evil.test/pixel.png)", options);
    const insecure = renderLessonHtml("![a](http://images.example.com/c.png)", options);

    expect(allowed).toContain(
      '<img src="https://images.example.com/c.png" alt="chart" loading="lazy" referrerpolicy="no-referrer">',
    );
    expect(upload).toContain('<img src="/api/uploads/communities/x/courses/y/a.png"');
    expect(blocked).not.toContain("<img");
    expect(blocked).toContain("tracker");
    expect(insecure).not.toContain("<img");
  });

  it("escapes image alt text and titles", () => {
    const html = renderLessonHtml(
      '![<b>x</b>"](https://images.example.com/c.png "t\\"x")',
      options,
    );

    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("does not let protocol relative or backslash image urls through", () => {
    expect(renderLessonHtml("![a](//evil.test/x.png)", options)).not.toContain("<img");
    expect(renderLessonHtml("![a](/\\evil.test/x.png)", options)).not.toContain("<img");
    expect(renderLessonHtml("![a](/api/uploads/../../x.png)", options)).not.toContain("<img");
  });

  it("returns an empty string for empty input", () => {
    expect(renderLessonHtml("")).toBe("");
    expect(renderLessonHtml(null)).toBe("");
  });
});

describe("withoutLeadingTitle", () => {
  it("drops a leading heading that repeats the lesson title", () => {
    const html = renderLessonHtml("# Getting started\n\nWelcome in.");

    expect(withoutLeadingTitle(html, "Getting started")).toBe("<p>Welcome in.</p>\n");
  });

  it("matches the title ignoring case and extra spaces", () => {
    const html = renderLessonHtml("## getting  STARTED \n\nWelcome in.");

    expect(withoutLeadingTitle(html, " Getting started")).toBe("<p>Welcome in.</p>\n");
  });

  it("matches titles with characters that are escaped in HTML", () => {
    const html = renderLessonHtml('# Tools & "tricks"\n\nBody');

    expect(withoutLeadingTitle(html, 'Tools & "tricks"')).toBe("<p>Body</p>\n");
  });

  it("keeps a leading heading with different text", () => {
    const html = renderLessonHtml("# Before you start\n\nBody");

    expect(withoutLeadingTitle(html, "Getting started")).toBe(html);
  });

  it("keeps a matching heading that is not the first block", () => {
    const html = renderLessonHtml("Intro\n\n# Getting started");

    expect(withoutLeadingTitle(html, "Getting started")).toBe(html);
  });
});

describe("findBlockedImages", () => {
  it("lists image links that members will not see", () => {
    const markdown = [
      "![Diagram](https://cdn.other.test/a.png)",
      "![Upload](/api/uploads/communities/c1/posts/a.png)",
      "![Allowed](https://images.example.com/b.png)",
      "![Plain](http://images.example.com/c.png)",
    ].join("\n\n");

    expect(findBlockedImages(markdown, options)).toEqual([
      "https://cdn.other.test/a.png",
      "http://images.example.com/c.png",
    ]);
  });

  it("finds images inside lists and lists each link once", () => {
    const markdown = "- ![a](https://x.test/1.png)\n- ![b](https://x.test/1.png)";

    expect(findBlockedImages(markdown)).toEqual(["https://x.test/1.png"]);
  });

  it("returns nothing for empty markdown", () => {
    expect(findBlockedImages("")).toEqual([]);
  });
});
