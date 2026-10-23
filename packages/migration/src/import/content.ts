import {
  ContentValidationError,
  extractExcerpt,
  extractPlainText,
  parseContent,
  renderContentHtml,
  type ContentDocument,
} from "@cohory/posts";

const uuidSegment = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxDepth = 64;

export interface KeyRewrite {
  readonly sourceCommunityId: string;
  readonly targetCommunityId: string;
  readonly courseId: (sourceId: string) => string | undefined;
}

export function rewriteStorageKey(key: string, rewrite: KeyRewrite): string | null {
  const prefix = `communities/${rewrite.sourceCommunityId}/`;
  if (!key.startsWith(prefix)) {
    return null;
  }
  const rest = key
    .slice(prefix.length)
    .split("/")
    .map((segment) =>
      uuidSegment.test(segment) ? (rewrite.courseId(segment) ?? segment) : segment,
    );
  return `communities/${rewrite.targetCommunityId}/${rest.join("/")}`;
}

export interface ContentRewrite {
  readonly key: (key: string) => string | null;
  readonly user: (sourceId: string) => string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class TooDeepError extends Error {}

function rewriteNode(node: unknown, rewrite: ContentRewrite, depth: number): unknown {
  if (depth > maxDepth) {
    throw new TooDeepError();
  }
  if (Array.isArray(node)) {
    return node
      .map((child) => rewriteNode(child, rewrite, depth + 1))
      .filter((child) => child !== undefined);
  }
  if (!isRecord(node)) {
    return node;
  }
  const attrs = isRecord(node.attrs) ? node.attrs : null;
  if (node.type === "image" && attrs) {
    const key = typeof attrs.key === "string" ? rewrite.key(attrs.key) : null;
    return key === null ? undefined : { ...node, attrs: { ...attrs, key } };
  }
  if (node.type === "mention" && attrs) {
    const id = typeof attrs.id === "string" ? rewrite.user(attrs.id) : undefined;
    if (id === undefined) {
      const label = typeof attrs.label === "string" ? attrs.label : "member";
      return { type: "text", text: `@${label}` };
    }
    return { ...node, attrs: { ...attrs, id } };
  }
  return Object.fromEntries(
    Object.entries(node).map(([name, value]) => [name, rewriteNode(value, rewrite, depth + 1)]),
  );
}

export interface RenderedImport {
  readonly body: ContentDocument;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly excerpt: string;
}

export type ImportContentResult =
  | { readonly ok: true; readonly content: RenderedImport }
  | { readonly ok: false; readonly reason: string };

export function importContent(
  raw: unknown,
  rewrite: ContentRewrite,
  options: { readonly allowImages: boolean; readonly imageUrl: (key: string) => string },
): ImportContentResult {
  let rewritten: unknown;
  try {
    rewritten = rewriteNode(raw, rewrite, 0);
  } catch (error: unknown) {
    if (error instanceof TooDeepError) {
      return { ok: false, reason: "The content is nested too deeply." };
    }
    throw error;
  }
  let body: ContentDocument;
  try {
    body = parseContent(rewritten, { allowImages: options.allowImages });
  } catch (error: unknown) {
    if (error instanceof ContentValidationError) {
      return { ok: false, reason: error.issues[0]?.message ?? "The content is not valid." };
    }
    throw error;
  }
  return {
    ok: true,
    content: {
      body,
      bodyHtml: renderContentHtml(body, { imageUrl: options.imageUrl }),
      bodyText: extractPlainText(body),
      excerpt: extractExcerpt(body),
    },
  };
}
