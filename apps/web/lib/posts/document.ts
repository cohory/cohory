import type { BlockNode, ContentDocument, InlineNode, Mark } from "@cohory/posts";
import {
  resolveEmbed,
  type Block,
  type ComposeImage,
  type Inline,
  type PostDocument,
  type TextMark,
} from "@cohory/ui";

export interface DocumentImage {
  readonly key: string;
  readonly url: string;
}

function toMarks(marks: TextMark[] | undefined, href: string | undefined): Mark[] {
  const result: Mark[] = [];
  for (const mark of marks ?? []) {
    if (mark === "link") {
      if (href) result.push({ type: "link", attrs: { href } });
    } else {
      result.push({ type: mark });
    }
  }
  return result;
}

function toInlineNodes(nodes: readonly Inline[]): InlineNode[] {
  const result: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "mention") {
      result.push({ type: "mention", attrs: { id: node.userId, label: node.label } });
      continue;
    }
    const marks = toMarks(node.marks, node.href);
    node.text.split("\n").forEach((line, index) => {
      if (index > 0) result.push({ type: "hardBreak" });
      if (line === "") return;
      result.push(
        marks.length > 0 ? { type: "text", text: line, marks } : { type: "text", text: line },
      );
    });
  }
  return result;
}

function paragraph(nodes: readonly Inline[]): BlockNode {
  const content = toInlineNodes(nodes);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

export function toContentDocument(document: PostDocument): ContentDocument {
  const content = document.content.map((block): BlockNode => {
    switch (block.type) {
      case "paragraph":
        return paragraph(block.content);
      case "bulletList":
        return {
          type: "bulletList",
          content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
        };
      case "image":
        return {
          type: "image",
          attrs: {
            key: block.key,
            ...(block.alt ? { alt: block.alt } : {}),
            ...(block.width ? { width: block.width } : {}),
            ...(block.height ? { height: block.height } : {}),
          },
        };
      case "embed":
        return { type: "embed", attrs: { url: block.url } };
    }
  });
  return { type: "doc", content };
}

function fromMarks(marks: readonly Mark[] | undefined): { marks: TextMark[]; href?: string } {
  const result: TextMark[] = [];
  let href: string | undefined;
  for (const mark of marks ?? []) {
    if (mark.type === "link") {
      result.push("link");
      href = mark.attrs.href;
    } else if (mark.type === "bold" || mark.type === "italic") {
      result.push(mark.type);
    }
  }
  return href ? { marks: result, href } : { marks: result };
}

function fromInlineNodes(nodes: readonly InlineNode[] | undefined): Inline[] {
  const result: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "mention") {
      result.push({ type: "mention", userId: node.attrs.id, label: node.attrs.label });
      continue;
    }
    const previous = result.at(-1);
    if (node.type === "hardBreak") {
      if (previous?.type === "text" && !previous.marks) {
        result[result.length - 1] = { ...previous, text: `${previous.text}\n` };
      } else {
        result.push({ type: "text", text: "\n" });
      }
      continue;
    }
    const { marks, href } = fromMarks(node.marks);
    result.push({
      type: "text",
      text: node.text,
      ...(marks.length > 0 ? { marks } : {}),
      ...(href ? { href } : {}),
    });
  }
  return result;
}

function flattenInlines(blocks: readonly BlockNode[]): Inline[] {
  const result: Inline[] = [];
  for (const block of blocks) {
    const inlines = blockInlines(block);
    if (inlines.length === 0) continue;
    if (result.length > 0) result.push({ type: "text", text: "\n" });
    result.push(...inlines);
  }
  return result;
}

function blockInlines(block: BlockNode): Inline[] {
  switch (block.type) {
    case "paragraph":
      return fromInlineNodes(block.content);
    case "codeBlock":
      return (block.content ?? []).map((node) => ({ type: "text", text: node.text }));
    case "bulletList":
    case "orderedList":
      return flattenInlines(block.content.flatMap((item) => item.content));
    case "blockquote":
      return flattenInlines(block.content);
    case "embed":
      return [{ type: "text", text: block.attrs.url, marks: ["link"], href: block.attrs.url }];
    case "image":
      return [];
  }
}

function fromBlock(block: BlockNode, images: ReadonlyMap<string, string>): Block[] {
  switch (block.type) {
    case "image": {
      const url = images.get(block.attrs.key);
      if (!url) return [];
      return [
        {
          type: "image",
          key: block.attrs.key,
          url,
          ...(block.attrs.alt ? { alt: block.attrs.alt } : {}),
          ...(block.attrs.width ? { width: block.attrs.width } : {}),
          ...(block.attrs.height ? { height: block.attrs.height } : {}),
        },
      ];
    }
    case "embed": {
      const embed = resolveEmbed(block.attrs.url);
      return embed
        ? [{ type: "embed", provider: embed.provider, url: block.attrs.url }]
        : [{ type: "paragraph", content: blockInlines(block) }];
    }
    case "bulletList":
    case "orderedList":
      return [
        {
          type: "bulletList",
          items: block.content.map((item) => flattenInlines(item.content)),
        },
      ];
    default: {
      const content = blockInlines(block);
      return content.length > 0 ? [{ type: "paragraph", content }] : [];
    }
  }
}

export function toPostDocument(
  document: ContentDocument,
  images: readonly DocumentImage[] = [],
): PostDocument {
  const urls = new Map(images.map((image) => [image.key, image.url]));
  return { type: "doc", content: document.content.flatMap((block) => fromBlock(block, urls)) };
}

function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "mention") return `@${node.label.replace(/\s+/g, "")}`;
      const marks = node.marks ?? [];
      if (marks.includes("link")) return node.href ?? node.text;
      let text = node.text;
      if (marks.includes("italic")) text = `*${text}*`;
      if (marks.includes("bold")) text = `**${text}**`;
      return text;
    })
    .join("");
}

export function documentToText(document: PostDocument): string {
  return document.content
    .flatMap((block): string[] => {
      switch (block.type) {
        case "paragraph":
          return [inlineText(block.content)];
        case "bulletList":
          return [block.items.map((item) => `- ${inlineText(item)}`).join("\n")];
        case "embed":
          return [block.url];
        case "image":
          return [];
      }
    })
    .join("\n\n");
}

export function documentImages(document: PostDocument): ComposeImage[] {
  return document.content.flatMap((block): ComposeImage[] =>
    block.type === "image"
      ? [
          {
            key: block.key,
            url: block.url,
            ...(block.alt ? { alt: block.alt } : {}),
            ...(block.width ? { width: block.width } : {}),
            ...(block.height ? { height: block.height } : {}),
          },
        ]
      : [],
  );
}
