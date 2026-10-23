import type { BlockNode, ContentDocument, InlineNode } from "./schema";
import { walk } from "./walk";

export function collectMentions(doc: ContentDocument): string[] {
  const ids = new Set<string>();
  for (const node of walk(doc)) {
    if (node.type === "mention") {
      ids.add(node.attrs.id);
    }
  }
  return [...ids];
}

export interface ImageRef {
  readonly key: string;
  readonly width: number | null;
  readonly height: number | null;
}

export function collectImages(doc: ContentDocument): ImageRef[] {
  const images: ImageRef[] = [];
  for (const node of walk(doc)) {
    if (node.type === "image") {
      const { key, width, height } = node.attrs;
      images.push({ key, width: width ?? null, height: height ?? null });
    }
  }
  return images;
}

type InlineMapper = (node: InlineNode) => InlineNode[];

function mapBlock(node: BlockNode, fn: InlineMapper): BlockNode {
  switch (node.type) {
    case "paragraph":
      return node.content ? { ...node, content: node.content.flatMap(fn) } : node;
    case "blockquote":
      return { ...node, content: node.content.map((child) => mapBlock(child, fn)) };
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        content: node.content.map((item) => ({
          ...item,
          content: item.content.map((child) => mapBlock(child, fn)),
        })),
      };
    default:
      return node;
  }
}

function mapInlines(doc: ContentDocument, fn: InlineMapper): ContentDocument {
  return { ...doc, content: doc.content.map((node) => mapBlock(node, fn)) };
}

export function replaceUnresolvedMentions(
  doc: ContentDocument,
  resolved: ReadonlySet<string>,
): ContentDocument {
  return mapInlines(doc, (node) =>
    node.type === "mention" && !resolved.has(node.attrs.id)
      ? [{ type: "text", text: `@${node.attrs.label}` }]
      : [node],
  );
}

const usernameMention =
  /(^|[^A-Za-z0-9_@-])@([A-Za-z0-9][A-Za-z0-9-]{1,28}[A-Za-z0-9])(?![A-Za-z0-9-])/g;

function linkable(node: InlineNode): node is Extract<InlineNode, { type: "text" }> {
  return (
    node.type === "text" &&
    !(node.marks ?? []).some((mark) => mark.type === "code" || mark.type === "link")
  );
}

export function collectUsernameMentions(doc: ContentDocument): string[] {
  const names = new Set<string>();
  mapInlines(doc, (node) => {
    if (linkable(node)) {
      for (const match of node.text.matchAll(usernameMention)) {
        const name = match[2];
        if (name) {
          names.add(name.toLowerCase());
        }
      }
    }
    return [node];
  });
  return [...names];
}

export interface UsernameTarget {
  readonly userId: string;
  readonly username: string;
}

function splitText(
  node: Extract<InlineNode, { type: "text" }>,
  targets: ReadonlyMap<string, UsernameTarget>,
): InlineNode[] {
  const parts: InlineNode[] = [];
  let rest = 0;
  const pushText = (text: string) => {
    if (text.length > 0) {
      parts.push({ ...node, text });
    }
  };
  for (const match of node.text.matchAll(usernameMention)) {
    const name = match[2];
    const target = name ? targets.get(name.toLowerCase()) : undefined;
    if (!target) {
      continue;
    }
    const start = match.index + (match[1]?.length ?? 0);
    pushText(node.text.slice(rest, start));
    parts.push({ type: "mention", attrs: { id: target.userId, label: target.username } });
    rest = start + 1 + (name?.length ?? 0);
  }
  if (rest === 0) {
    return [node];
  }
  pushText(node.text.slice(rest));
  return parts;
}

export function linkUsernameMentions(
  doc: ContentDocument,
  targets: ReadonlyMap<string, UsernameTarget>,
): ContentDocument {
  if (targets.size === 0) {
    return doc;
  }
  return mapInlines(doc, (node) => (linkable(node) ? splitText(node, targets) : [node]));
}
