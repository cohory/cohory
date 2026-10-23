import {
  contentDocumentSchema,
  maxContentDepth,
  maxContentNodes,
  maxContentTextLength,
  maxEmbeds,
  maxMentions,
  maxPostImages,
  type ContentDocument,
} from "./schema";
import { stripInvisibleDeep } from "./invisible";
import { walk } from "./walk";

export interface ContentIssue {
  readonly path: string;
  readonly message: string;
}

export class ContentValidationError extends Error {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly ContentIssue[]) {
    super("content is invalid");
    this.name = "ContentValidationError";
  }
}

export interface ParseContentOptions {
  readonly allowImages: boolean;
}

function fail(message: string, path = "body"): never {
  throw new ContentValidationError([{ path, message }]);
}

function checkShape(input: unknown): void {
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || typeof entry.value !== "object" || entry.value === null) {
      continue;
    }
    nodes += 1;
    if (nodes > maxContentNodes) {
      fail("The content has too many parts. Shorten it and try again.");
    }
    if (entry.depth > maxContentDepth * 4 + 8) {
      fail("The content is nested too deeply.");
    }
    for (const child of Object.values(entry.value)) {
      stack.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

function blockDepth(doc: ContentDocument): number {
  let max = 0;
  const stack: { node: ContentDocument["content"][number]; depth: number }[] = doc.content.map(
    (node) => ({ node, depth: 1 }),
  );
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    max = Math.max(max, entry.depth);
    const { node } = entry;
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const item of node.content) {
        for (const child of item.content) {
          stack.push({ node: child, depth: entry.depth + 1 });
        }
      }
    } else if (node.type === "blockquote") {
      for (const child of node.content) {
        stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
  return max;
}

export function parseContent(input: unknown, options: ParseContentOptions): ContentDocument {
  checkShape(input);
  const parsed = contentDocumentSchema.safeParse(stripInvisibleDeep(input));
  if (!parsed.success) {
    throw new ContentValidationError(
      parsed.error.issues.map((issue) => ({
        path: ["body", ...issue.path].join("."),
        message: issue.message,
      })),
    );
  }
  const doc = parsed.data;
  if (blockDepth(doc) > maxContentDepth) {
    fail("The content is nested too deeply.");
  }

  let textLength = 0;
  let images = 0;
  let embeds = 0;
  let mentions = 0;
  let hasContent = false;
  for (const node of walk(doc)) {
    switch (node.type) {
      case "text":
        textLength += node.text.length;
        hasContent ||= node.text.trim().length > 0;
        break;
      case "mention":
        mentions += 1;
        hasContent = true;
        break;
      case "image":
        images += 1;
        hasContent = true;
        break;
      case "embed":
        embeds += 1;
        hasContent = true;
        break;
    }
  }

  const issues: string[] = [];
  if (textLength > maxContentTextLength) {
    issues.push(`The text is longer than ${maxContentTextLength} characters.`);
  }
  if (images > 0 && !options.allowImages) {
    issues.push("Images are not allowed here.");
  }
  if (images > maxPostImages) {
    issues.push(`A post can have up to ${maxPostImages} images.`);
  }
  if (embeds > maxEmbeds) {
    issues.push(`Content can have up to ${maxEmbeds} video embeds.`);
  }
  if (mentions > maxMentions) {
    issues.push(`Content can mention up to ${maxMentions} people.`);
  }
  if (!hasContent) {
    issues.push("Write something before posting.");
  }
  if (issues.length > 0) {
    throw new ContentValidationError(issues.map((message) => ({ path: "body", message })));
  }
  return doc;
}
