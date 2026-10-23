import {
  resolveEmbed,
  type Block,
  type EmbedBlock,
  type ImageBlock,
  type Inline,
  type TextMark,
  type PostDocument,
} from "./content";

export interface MentionTarget {
  userId: string;
  label: string;
}

export interface ComposeImage {
  key: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ComposeOptions {
  resolveMention?: (username: string) => MentionTarget | null | undefined;
  blocks?: "all" | "paragraphs";
  headings?: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const MENTION_PATTERN = /(^|[^\w@])@([A-Za-z0-9_][A-Za-z0-9_.-]{0,31})/g;
const BULLET_PATTERN = /^\s*[-*]\s+/;
const HEADING_LINE = /^(## +\S.*)$/gm;

function trimUrl(raw: string): string {
  return raw.replace(TRAILING_PUNCTUATION, "");
}

export function findUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => trimUrl(match[0]));
}

export function findMentions(text: string): string[] {
  const names = [...text.matchAll(MENTION_PATTERN)].map((match) =>
    (match[2] ?? "").replace(/[.-]+$/, ""),
  );
  return [...new Set(names.filter(Boolean))];
}

export function extractEmbeds(text: string): { text: string; embeds: EmbedBlock[] } {
  const embeds: EmbedBlock[] = [];
  const seen = new Set<string>();
  const stripped = text.replace(URL_PATTERN, (raw) => {
    const url = trimUrl(raw);
    const embed = resolveEmbed(url);
    if (!embed) return raw;
    if (!seen.has(embed.src)) {
      seen.add(embed.src);
      embeds.push({ type: "embed", provider: embed.provider, url });
    }
    return raw.slice(url.length);
  });
  return { text: stripped, embeds };
}

interface Token {
  index: number;
  length: number;
  build: (marks: TextMark[]) => Inline[];
}

function sameMarks(a: TextMark[] | undefined, b: TextMark[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

function textNode(text: string, marks: TextMark[], href?: string): Inline {
  return {
    type: "text",
    text,
    ...(marks.length > 0 ? { marks } : {}),
    ...(href ? { href } : {}),
  };
}

function mergeText(nodes: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (
      previous?.type === "text" &&
      node.type === "text" &&
      !previous.href &&
      !node.href &&
      sameMarks(previous.marks, node.marks)
    ) {
      merged[merged.length - 1] = { ...previous, text: previous.text + node.text };
      continue;
    }
    if (node.type === "text" && node.text === "") continue;
    merged.push(node);
  }
  return merged;
}

function withMark(marks: TextMark[], mark: TextMark): TextMark[] {
  return marks.includes(mark) ? marks : [...marks, mark];
}

function nextToken(text: string, options: ComposeOptions): Token | null {
  const candidates: Token[] = [];

  const bold = /\*\*(\S(?:[\s\S]*?\S)?)\*\*/.exec(text);
  if (bold) {
    const inner = bold[1] ?? "";
    candidates.push({
      index: bold.index,
      length: bold[0].length,
      build: (marks) => parseInline(inner, withMark(marks, "bold"), options),
    });
  }

  const italic = /(?<!\*)\*(?!\*)(\S(?:[^*]*?\S)?)\*(?!\*)/.exec(text);
  if (italic) {
    const inner = italic[1] ?? "";
    candidates.push({
      index: italic.index,
      length: italic[0].length,
      build: (marks) => parseInline(inner, withMark(marks, "italic"), options),
    });
  }

  const url = new RegExp(URL_PATTERN.source).exec(text);
  if (url) {
    const href = trimUrl(url[0]);
    candidates.push({
      index: url.index,
      length: href.length,
      build: (marks) => [textNode(href, withMark(marks, "link"), href)],
    });
  }

  if (options.resolveMention) {
    for (const match of text.matchAll(MENTION_PATTERN)) {
      const prefix = match[1] ?? "";
      const username = (match[2] ?? "").replace(/[.-]+$/, "");
      const target = options.resolveMention(username);
      if (!target) continue;
      candidates.push({
        index: match.index + prefix.length,
        length: username.length + 1,
        build: () => [{ type: "mention", userId: target.userId, label: target.label }],
      });
      break;
    }
  }

  return candidates.reduce<Token | null>(
    (earliest, token) => (!earliest || token.index < earliest.index ? token : earliest),
    null,
  );
}

function parseInline(text: string, marks: TextMark[], options: ComposeOptions): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const token = nextToken(rest, options);
    if (!token) {
      nodes.push(textNode(rest, marks));
      break;
    }
    if (token.index > 0) nodes.push(textNode(rest.slice(0, token.index), marks));
    nodes.push(...token.build(marks));
    rest = rest.slice(token.index + token.length);
  }
  return nodes;
}

export function composeInline(text: string, options: ComposeOptions = {}): Inline[] {
  return mergeText(parseInline(text, [], options));
}

function textBlocks(text: string, options: ComposeOptions): Block[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const chunks = (options.headings ? normalized.replace(HEADING_LINE, "\n\n$1\n\n") : normalized)
    .split(/\n\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .filter((line) => line.trim() !== "")
        .join("\n"),
    )
    .filter((chunk) => chunk.trim() !== "");

  return chunks.map((chunk): Block => {
    const lines = chunk.split("\n");
    if (options.blocks !== "paragraphs" && lines.every((line) => BULLET_PATTERN.test(line))) {
      return {
        type: "bulletList",
        items: lines.map((line) => composeInline(line.replace(BULLET_PATTERN, ""), options)),
      };
    }
    return { type: "paragraph", content: composeInline(chunk.trim(), options) };
  });
}

export function composeDocument(
  text: string,
  images: ComposeImage[] = [],
  embeds: EmbedBlock[] = [],
  options: ComposeOptions = {},
): PostDocument {
  if (options.blocks === "paragraphs") {
    return { type: "doc", content: textBlocks(text, options) };
  }

  const extracted = extractEmbeds(text);
  const embedUrls = new Set(embeds.map((embed) => embed.url));
  const allEmbeds = [...embeds, ...extracted.embeds.filter((embed) => !embedUrls.has(embed.url))];
  const imageBlocks = images.map((image): ImageBlock => ({
    type: "image",
    key: image.key,
    url: image.url,
    ...(image.alt ? { alt: image.alt } : {}),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
  }));

  return {
    type: "doc",
    content: [...textBlocks(extracted.text, options), ...imageBlocks, ...allEmbeds],
  };
}

export function isDocumentEmpty(document: PostDocument): boolean {
  return document.content.length === 0;
}
