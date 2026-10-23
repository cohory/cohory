import { embedProviderOf } from "./embeds";
import {
  isSafeHref,
  type BlockNode,
  type ContentDocument,
  type InlineNode,
  type Mark,
} from "./schema";

export interface RenderOptions {
  readonly imageUrl?: (key: string) => string;
}

const linkRel = "noopener noreferrer nofollow ugc";
const markOrder: readonly Mark["type"][] = ["link", "bold", "italic", "code"];
const markTags = { bold: "strong", italic: "em", code: "code" } as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(href: string): string | null {
  return isSafeHref(href) ? new URL(href).href : null;
}

function anchor(href: string, inner: string): string {
  return `<a href="${escapeHtml(href)}" rel="${linkRel}" target="_blank">${inner}</a>`;
}

function renderText(text: string, marks: readonly Mark[] = []): string {
  const sorted = [...marks].sort((a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type));
  let html = escapeHtml(text);
  for (const mark of sorted.reverse()) {
    if (mark.type === "link") {
      const href = safeHref(mark.attrs.href);
      html = href ? anchor(href, html) : html;
    } else {
      const tag = markTags[mark.type];
      html = `<${tag}>${html}</${tag}>`;
    }
  }
  return html;
}

function renderInline(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return renderText(node.text, node.marks);
    case "mention":
      return `<span data-mention-id="${escapeHtml(node.attrs.id)}">@${escapeHtml(node.attrs.label)}</span>`;
    case "hardBreak":
      return "<br>";
  }
}

function renderBlocks(nodes: readonly BlockNode[], options: RenderOptions): string {
  return nodes.map((node) => renderBlock(node, options)).join("");
}

function defaultImageUrl(key: string): string {
  return `/api/uploads/${key}`;
}

function renderBlock(node: BlockNode, options: RenderOptions): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${(node.content ?? []).map(renderInline).join("")}</p>`;
    case "codeBlock":
      return `<pre><code>${(node.content ?? []).map((t) => escapeHtml(t.text)).join("")}</code></pre>`;
    case "blockquote":
      return `<blockquote>${renderBlocks(node.content, options)}</blockquote>`;
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "bulletList" ? "ul" : "ol";
      const items = node.content.map((item) => `<li>${renderBlocks(item.content, options)}</li>`);
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    case "embed": {
      const provider = embedProviderOf(node.attrs.url);
      if (!provider) {
        return "";
      }
      const url = escapeHtml(node.attrs.url);
      return `<div data-embed="" data-embed-provider="${provider}" data-embed-url="${url}">${anchor(node.attrs.url, url)}</div>`;
    }
    case "image": {
      const { key, width, height, alt } = node.attrs;
      const src = (options.imageUrl ?? defaultImageUrl)(key);
      const size = `${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}`;
      return `<figure data-image-key="${escapeHtml(key)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? "")}"${size} loading="lazy"></figure>`;
    }
  }
}

export function renderContentHtml(doc: ContentDocument, options: RenderOptions = {}): string {
  return renderBlocks(doc.content, options);
}
