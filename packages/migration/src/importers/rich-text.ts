import { embedProviderOf, maxContentTextLength, type ContentDocument } from "@cohory/posts";
import MarkdownIt from "markdown-it";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Block = ContentDocument["content"][number];
type ListItem = { type: "listItem"; content: Block[] };

type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string } };
type Inline = { type: "text"; text: string; marks?: Mark[] } | { type: "hardBreak" };

export interface ConvertedText {
  readonly doc: ContentDocument;
  readonly droppedImages: number;
  readonly truncated: boolean;
}

const dropped = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "title",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "svg",
  "math",
  "canvas",
  "video",
  "audio",
  "picture",
  "source",
  "track",
  "link",
  "meta",
  "base",
  "frameset",
  "frame",
]);

const blockTags = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "dl",
  "dt",
  "dd",
  "address",
  "details",
  "summary",
  "center",
]);

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const maxBlockDepth = 4;
const maxEmbeds = 10;
const maxParts = 3_500;
const maxHrefLength = 2048;

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (href.length === 0 || href.length > maxHrefLength) return null;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name === name)?.value;
}

function isElement(node: ChildNode): node is Element {
  return "tagName" in node && node.nodeName !== "template";
}

function textContent(node: ChildNode): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if (!isElement(node) || dropped.has(node.tagName)) return "";
  return node.childNodes.map(textContent).join("");
}

class Converter {
  private textLength = 0;
  private parts = 0;
  private embeds = 0;
  droppedImages = 0;
  truncated = false;

  private room(): number {
    return maxContentTextLength - this.textLength;
  }

  private take(text: string, cost: number): string | null {
    if (this.truncated) return null;
    if (this.parts + cost > maxParts) {
      this.truncated = true;
      return null;
    }
    const room = this.room();
    if (room <= 0) {
      this.truncated = true;
      return null;
    }
    const kept = text.length > room ? text.slice(0, room) : text;
    if (kept.length < text.length) this.truncated = true;
    this.textLength += kept.length;
    this.parts += cost;
    return kept;
  }

  blocks(nodes: readonly ChildNode[], depth: number): Block[] {
    const out: Block[] = [];
    let inline: Inline[] = [];
    const flush = () => {
      const content = this.trimInline(inline);
      if (content.length > 0) out.push({ type: "paragraph", content });
      inline = [];
    };
    for (const node of nodes) {
      if (!isElement(node)) {
        if (node.nodeName === "#text" && "value" in node) {
          this.inline(node, [], inline);
        }
        continue;
      }
      const tag = node.tagName;
      if (dropped.has(tag)) continue;
      if (tag === "img") {
        this.droppedImages += 1;
        continue;
      }
      if (tag === "iframe") {
        flush();
        const src = safeHref(attr(node, "src"));
        if (src && embedProviderOf(src) && this.embeds < maxEmbeds && !this.truncated) {
          this.embeds += 1;
          this.parts += 3;
          out.push({ type: "embed", attrs: { url: src } });
        }
        continue;
      }
      if (tag === "pre") {
        flush();
        const text = this.take(textContent(node).replace(/\n$/, ""), 3);
        if (text && text.trim().length > 0) {
          out.push({ type: "codeBlock", content: [{ type: "text", text }] });
        }
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        flush();
        if (depth >= maxBlockDepth) {
          out.push(...this.blocks(node.childNodes, depth));
          continue;
        }
        const items: ListItem[] = [];
        for (const child of node.childNodes) {
          if (!isElement(child) || child.tagName !== "li") continue;
          const content = this.blocks(child.childNodes, depth + 1);
          if (content.length > 0) items.push({ type: "listItem", content });
        }
        if (items.length > 0) {
          this.parts += 2 + items.length * 2;
          out.push({ type: tag === "ul" ? "bulletList" : "orderedList", content: items });
        }
        continue;
      }
      if (tag === "blockquote") {
        flush();
        const content = this.blocks(node.childNodes, depth + 1);
        if (content.length === 0) continue;
        if (depth >= maxBlockDepth) {
          out.push(...content);
        } else {
          this.parts += 2;
          out.push({ type: "blockquote", content });
        }
        continue;
      }
      if (tag === "li") {
        flush();
        out.push(...this.blocks(node.childNodes, depth));
        continue;
      }
      if (headingTags.has(tag)) {
        flush();
        this.inlineChildren(node, [{ type: "bold" }], inline);
        flush();
        continue;
      }
      if (blockTags.has(tag)) {
        flush();
        out.push(...this.blocks(node.childNodes, depth));
        continue;
      }
      if (tag === "br") {
        if (this.take("", 1) !== null) inline.push({ type: "hardBreak" });
        continue;
      }
      if (tag === "hr") {
        flush();
        continue;
      }
      this.inline(node, [], inline);
    }
    flush();
    return out;
  }

  private inlineChildren(element: Element, marks: readonly Mark[], out: Inline[]): void {
    for (const child of element.childNodes) this.inline(child, marks, out);
  }

  private inline(node: ChildNode, marks: readonly Mark[], out: Inline[]): void {
    if (node.nodeName === "#text" && "value" in node) {
      const collapsed = node.value.replace(/\s+/g, " ");
      if (collapsed.length === 0) return;
      const text = this.take(collapsed, 2 + marks.length * 2);
      if (!text) return;
      const previous = out.at(-1);
      if (previous?.type === "text" && sameMarks(previous.marks ?? [], marks)) {
        previous.text += text;
        return;
      }
      out.push(
        marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text },
      );
      return;
    }
    if (!isElement(node)) return;
    const tag = node.tagName;
    if (dropped.has(tag) || tag === "iframe" || tag === "pre") return;
    if (tag === "img") {
      this.droppedImages += 1;
      return;
    }
    if (tag === "br") {
      if (this.take("", 1) !== null) out.push({ type: "hardBreak" });
      return;
    }
    const mark = markFor(node);
    const next = mark && !marks.some((m) => m.type === mark.type) ? [...marks, mark] : marks;
    this.inlineChildren(node, next, out);
  }

  private trimInline(nodes: Inline[]): Inline[] {
    const result = [...nodes];
    while (result[0]?.type === "hardBreak") result.shift();
    while (result.at(-1)?.type === "hardBreak") result.pop();
    const first = result[0];
    if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
    const last = result.at(-1);
    if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
    const kept = result.filter((node) => node.type !== "text" || node.text.length > 0);
    return kept.some((node) => node.type === "text" && node.text.trim().length > 0) ? kept : [];
  }
}

function markFor(element: Element): Mark | null {
  switch (element.tagName) {
    case "strong":
    case "b":
      return { type: "bold" };
    case "em":
    case "i":
      return { type: "italic" };
    case "code":
    case "kbd":
    case "samp":
      return { type: "code" };
    case "a": {
      const href = safeHref(attr(element, "href"));
      return href ? { type: "link", attrs: { href } } : null;
    }
    default:
      return null;
  }
}

function markKey(mark: Mark): string {
  return mark.type === "link" ? `link:${mark.attrs.href}` : mark.type;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(markKey));
  return b.every((mark) => keys.has(markKey(mark)));
}

export function htmlToDocument(html: string): ConvertedText {
  const converter = new Converter();
  const fragment = parseFragment(html);
  const content = converter.blocks(fragment.childNodes, 1);
  return {
    doc: { type: "doc", content },
    droppedImages: converter.droppedImages,
    truncated: converter.truncated,
  };
}

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });

export function markdownToDocument(source: string): ConvertedText {
  return htmlToDocument(markdown.render(source));
}

const looksLikeHtml = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function plainOrHtmlToDocument(source: string): ConvertedText {
  if (looksLikeHtml.test(source)) return htmlToDocument(source);
  const paragraphs = source
    .split(/\r?\n\s*\r?\n/)
    .map((block) => `<p>${escapeText(block).replace(/\r?\n/g, "<br>")}</p>`);
  return htmlToDocument(paragraphs.join(""));
}
