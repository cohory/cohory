import { describe, expect, it } from "vitest";

import { applyMarkdownFormat, imageAltFromFileName, insertBlock } from "./markdown-edit";

function selected(edit: { text: string; selectionStart: number; selectionEnd: number }) {
  return edit.text.slice(edit.selectionStart, edit.selectionEnd);
}

describe("applyMarkdownFormat", () => {
  it("wraps the selection in bold and keeps it selected", () => {
    const edit = applyMarkdownFormat("say hello now", 4, 9, "bold");

    expect(edit.text).toBe("say **hello** now");
    expect(selected(edit)).toBe("hello");
  });

  it("inserts placeholder text when nothing is selected", () => {
    const edit = applyMarkdownFormat("", 0, 0, "bold");

    expect(edit.text).toBe("**bold text**");
    expect(selected(edit)).toBe("bold text");
  });

  it("turns the current line into a heading", () => {
    const edit = applyMarkdownFormat("one\ntwo", 5, 5, "heading");

    expect(edit.text).toBe("one\n## two");
  });

  it("turns every selected line into a list item", () => {
    const edit = applyMarkdownFormat("a\nb\nc", 0, 3, "list");

    expect(edit.text).toBe("- a\n- b\nc");
  });

  it("makes a link and selects the address to replace", () => {
    const edit = applyMarkdownFormat("see docs", 4, 8, "link");

    expect(edit.text).toBe("see [docs](https://)");
    expect(selected(edit)).toBe("https://");
  });

  it("uses inline code for one line and a fenced block for several", () => {
    expect(applyMarkdownFormat("run x", 4, 5, "code").text).toBe("run `x`");
    expect(applyMarkdownFormat("a\nb", 0, 3, "code").text).toBe("```\na\nb\n```");
  });
});

describe("insertBlock", () => {
  it("puts the block on its own lines and moves the cursor after it", () => {
    const edit = insertBlock("before after", 6, 6, "![x](/a.png)");

    expect(edit.text).toBe("before\n\n![x](/a.png)\n\n after");
    expect(edit.selectionStart).toBe(edit.selectionEnd);
    expect(edit.text.slice(0, edit.selectionStart)).toBe("before\n\n![x](/a.png)\n\n");
  });

  it("adds no blank lines at the start of an empty body", () => {
    expect(insertBlock("", 0, 0, "![x](/a.png)").text).toBe("![x](/a.png)\n\n");
  });
});

describe("imageAltFromFileName", () => {
  it("turns a file name into readable alt text", () => {
    expect(imageAltFromFileName("pricing_diagram-v2.png")).toBe("pricing diagram v2");
  });

  it("drops characters that would break the markdown", () => {
    expect(imageAltFromFileName("[a]](b).jpg")).toBe("a b");
    expect(imageAltFromFileName(".png")).toBe("Image");
  });
});
