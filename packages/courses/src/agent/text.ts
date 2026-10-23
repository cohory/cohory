import MarkdownIt from "markdown-it";

const hiddenRanges: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
];
const htmlComment = /<!--[\s\S]*?(-->|$)/g;

function isVisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return !hiddenRanges.some(([low, high]) => code >= low && code <= high);
}

export function stripHidden(value: string): string {
  return Array.from(value.replace(/\r\n?/g, "\n")).filter(isVisible).join("");
}

export function plainLine(value: string): string {
  return stripHidden(value).replace(/\s+/g, " ").trim();
}

export function markdownText(value: string): string {
  return stripHidden(value).replace(htmlComment, "").trim();
}

const parser = new MarkdownIt("default", { html: true });

export function hasRawHtml(markdown: string): boolean {
  const walk = (tokens: ReturnType<MarkdownIt["parse"]>): boolean =>
    tokens.some(
      (token) =>
        token.type === "html_block" ||
        token.type === "html_inline" ||
        (token.children !== null && walk(token.children)),
    );
  return walk(parser.parse(markdown, {}));
}

export function withoutRawHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const drop = new Set<number>();
  for (const token of parser.parse(markdown, {})) {
    if (token.type === "html_block" && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) drop.add(line);
    }
  }
  return lines
    .filter((_, index) => !drop.has(index))
    .join("\n")
    .replace(/<\/?[A-Za-z][^<>]*>/g, (tag, offset: number, text: string) =>
      insideCode(text, offset) ? tag : "",
    );
}

function insideCode(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const fences = before.match(/^(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}
