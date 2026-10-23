import { z } from "zod";

import { embedProviderOf } from "./embeds";

export const maxContentTextLength = 20_000;
export const maxPostImages = 10;
export const maxEmbeds = 10;
export const maxMentions = 50;
export const maxContentDepth = 8;
export const maxContentNodes = 5_000;

const safeLinkProtocols = new Set(["http:", "https:", "mailto:"]);

export function isSafeHref(href: string): boolean {
  if (href !== href.trim() || !/^(https?|mailto):/i.test(href)) {
    return false;
  }
  try {
    return safeLinkProtocols.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

const boldMark = z.strictObject({ type: z.literal("bold") });
const italicMark = z.strictObject({ type: z.literal("italic") });
const codeMark = z.strictObject({ type: z.literal("code") });
const linkMark = z.strictObject({
  type: z.literal("link"),
  attrs: z.strictObject({
    href: z.string().max(2048).refine(isSafeHref, "Links must start with http, https, or mailto."),
  }),
});

const markSchema = z.discriminatedUnion("type", [boldMark, italicMark, codeMark, linkMark]);

const textNode = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z
    .array(markSchema)
    .max(4)
    .refine((marks) => new Set(marks.map((m) => m.type)).size === marks.length, {
      message: "A mark can appear only once on the same text.",
    })
    .optional(),
});

const plainTextNode = z.strictObject({ type: z.literal("text"), text: z.string().min(1) });

const mentionNode = z.strictObject({
  type: z.literal("mention"),
  attrs: z.strictObject({ id: z.uuid(), label: z.string().trim().min(1).max(80) }),
});

const hardBreakNode = z.strictObject({ type: z.literal("hardBreak") });

const inlineSchema = z.discriminatedUnion("type", [textNode, mentionNode, hardBreakNode]);

const paragraphNode = z.strictObject({
  type: z.literal("paragraph"),
  content: z.array(inlineSchema).optional(),
});

const codeBlockNode = z.strictObject({
  type: z.literal("codeBlock"),
  content: z.array(plainTextNode).optional(),
});

const embedNode = z.strictObject({
  type: z.literal("embed"),
  attrs: z.strictObject({
    url: z
      .string()
      .max(2048)
      .refine((url) => embedProviderOf(url) !== null, {
        message: "Embeds are limited to YouTube, Vimeo, Loom, and Wistia links over https.",
      }),
  }),
});

const dimension = z.int().min(1).max(20_000);

const imageNode = z.strictObject({
  type: z.literal("image"),
  attrs: z.strictObject({
    key: z.string().min(1).max(512),
    width: dimension.optional(),
    height: dimension.optional(),
    alt: z.string().max(300).optional(),
  }),
});

export type Mark = z.infer<typeof markSchema>;
export type TextNode = z.infer<typeof textNode>;
export type MentionNode = z.infer<typeof mentionNode>;
export type InlineNode = z.infer<typeof inlineSchema>;
export type ParagraphNode = z.infer<typeof paragraphNode>;
export type CodeBlockNode = z.infer<typeof codeBlockNode>;
export type EmbedNode = z.infer<typeof embedNode>;
export type ImageNode = z.infer<typeof imageNode>;

export interface ListItemNode {
  type: "listItem";
  content: BlockNode[];
}

export interface BulletListNode {
  type: "bulletList";
  content: ListItemNode[];
}

export interface OrderedListNode {
  type: "orderedList";
  content: ListItemNode[];
}

export interface BlockquoteNode {
  type: "blockquote";
  content: BlockNode[];
}

export type BlockNode =
  | ParagraphNode
  | CodeBlockNode
  | EmbedNode
  | ImageNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode;

export interface ContentDocument {
  type: "doc";
  content: BlockNode[];
}

const listItemNode: z.ZodType<ListItemNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("listItem"), content: z.array(blockSchema).min(1) }),
);

const bulletListNode: z.ZodType<BulletListNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("bulletList"), content: z.array(listItemNode).min(1) }),
);

const orderedListNode: z.ZodType<OrderedListNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("orderedList"), content: z.array(listItemNode).min(1) }),
);

const blockquoteNode: z.ZodType<BlockquoteNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("blockquote"), content: z.array(blockSchema).min(1) }),
);

const blockSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.union([
    paragraphNode,
    codeBlockNode,
    embedNode,
    imageNode,
    bulletListNode,
    orderedListNode,
    blockquoteNode,
  ]),
);

export const contentDocumentSchema: z.ZodType<ContentDocument> = z.strictObject({
  type: z.literal("doc"),
  content: z.array(blockSchema),
});
