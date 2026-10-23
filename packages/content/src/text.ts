import type { BlockNode, ContentDocument, InlineNode } from "./schema";

export const maxExcerptLength = 280;

function inlineText(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "mention":
      return `@${node.attrs.label}`;
    case "hardBreak":
      return "\n";
  }
}

function blockLines(node: BlockNode): string[] {
  switch (node.type) {
    case "paragraph":
      return [(node.content ?? []).map(inlineText).join("")];
    case "codeBlock":
      return [(node.content ?? []).map((t) => t.text).join("")];
    case "blockquote":
      return node.content.flatMap(blockLines);
    case "bulletList":
    case "orderedList":
      return node.content.flatMap((item) => item.content.flatMap(blockLines));
    case "embed":
      return [node.attrs.url];
    case "image":
      return node.attrs.alt ? [node.attrs.alt] : [];
  }
}

export function extractPlainText(doc: ContentDocument): string {
  return doc.content
    .flatMap(blockLines)
    .filter((line) => line.length > 0)
    .join("\n");
}

export function extractExcerpt(doc: ContentDocument, maxLength = maxExcerptLength): string {
  const text = extractPlainText(doc).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maxLength / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
