type MarkdownFormat = "heading" | "bold" | "list" | "link" | "code";

interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrap(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
  fallback: string,
): TextEdit {
  const inner = text.slice(start, end) || fallback;
  const selectionStart = start + before.length;
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    selectionStart,
    selectionEnd: selectionStart + inner.length,
  };
}

function prefixLines(
  text: string,
  start: number,
  end: number,
  prefix: string,
  firstOnly: boolean,
): TextEdit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lastIndex = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const found = text.indexOf("\n", lastIndex);
  const lineEnd = found === -1 ? text.length : found;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const changed = lines.map((line, index) => (firstOnly && index > 0 ? line : prefix + line));
  const added = firstOnly ? prefix.length : prefix.length * lines.length;
  return {
    text: text.slice(0, lineStart) + changed.join("\n") + text.slice(lineEnd),
    selectionStart: start + prefix.length,
    selectionEnd: end + added,
  };
}

function applyMarkdownFormat(
  text: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): TextEdit {
  switch (format) {
    case "bold":
      return wrap(text, start, end, "**", "**", "bold text");
    case "heading":
      return prefixLines(text, start, end, "## ", true);
    case "list":
      return prefixLines(text, start, end, "- ", false);
    case "code":
      return text.slice(start, end).includes("\n")
        ? wrap(text, start, end, "```\n", "\n```", "")
        : wrap(text, start, end, "`", "`", "code");
    case "link": {
      const label = text.slice(start, end) || "link text";
      const before = `${text.slice(0, start)}[${label}](`;
      return {
        text: `${before}https://)${text.slice(end)}`,
        selectionStart: before.length,
        selectionEnd: before.length + "https://".length,
      };
    }
  }
}

function insertBlock(text: string, start: number, end: number, block: string): TextEdit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead =
    before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const head = before + lead + block + trail;
  return { text: head + after, selectionStart: head.length, selectionEnd: head.length };
}

function imageAltFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const alt = base.replace(/[\s_\-[\]()!]+/g, " ").trim();
  return alt || "Image";
}

export {
  applyMarkdownFormat,
  imageAltFromFileName,
  insertBlock,
  type MarkdownFormat,
  type TextEdit,
};
