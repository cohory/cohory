import type { AuthorRef, RecordsBuilder } from "./builder";
import {
  htmlToDocument,
  markdownToDocument,
  plainOrHtmlToDocument,
  type ConvertedText,
} from "./rich-text";
import { asText, isObject, parseDate, pick } from "./tabular";

export interface JsonShape {
  readonly ids: readonly string[];
  readonly commentIds: readonly string[];
  readonly postKeys: readonly string[];
  readonly title: readonly string[];
  readonly html: readonly string[];
  readonly text: readonly string[];
  readonly textIs: "markdown" | "html";
  readonly author: readonly string[];
  readonly authorName: readonly string[];
  readonly authorEmail: readonly string[];
  readonly authorHandle: readonly string[];
  readonly authorId: readonly string[];
  readonly category: readonly string[];
  readonly createdAt: readonly string[];
  readonly updatedAt: readonly string[];
  readonly pinned: readonly string[];
  readonly comments: readonly string[];
  readonly replies: readonly string[];
  readonly commentPost: readonly string[];
  readonly commentParent: readonly string[];
}

const emptyText: ConvertedText = {
  doc: { type: "doc", content: [] },
  droppedImages: 0,
  truncated: false,
};

function stringOrNested(value: unknown): string | null {
  if (isObject(value)) return asText(pick(value, ["html", "body", "text", "content"]));
  return asText(value);
}

export function bodyOf(record: Record<string, unknown>, shape: JsonShape): ConvertedText {
  const html = stringOrNested(pick(record, shape.html));
  if (html) return htmlToDocument(html);
  const text = stringOrNested(pick(record, shape.text));
  if (!text) return emptyText;
  return shape.textIs === "markdown" ? markdownToDocument(text) : plainOrHtmlToDocument(text);
}

export function authorOf(record: Record<string, unknown>, shape: JsonShape): AuthorRef {
  const nested = pick(record, shape.author);
  const source = isObject(nested) ? nested : record;
  const fallbackName = isObject(nested) ? null : asText(nested);
  return {
    email: asText(pick(source, ["email", ...shape.authorEmail])),
    id: asText(pick(source, isObject(nested) ? ["id", ...shape.authorId] : shape.authorId)),
    name:
      asText(pick(source, isObject(nested) ? ["name", ...shape.authorName] : shape.authorName)) ??
      fallbackName,
    handle: asText(pick(source, ["handle", "username", ...shape.authorHandle])),
  };
}

function categoryOf(record: Record<string, unknown>, shape: JsonShape): string | null {
  const value = pick(record, shape.category);
  return isObject(value) ? asText(pick(value, ["name", "title"])) : asText(value);
}

function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = asText(value)?.toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

function addComments(
  builder: RecordsBuilder,
  file: string,
  list: unknown,
  shape: JsonShape,
  postKey: string | null,
  parentKey: string | null,
  path: string,
): void {
  if (!Array.isArray(list)) return;
  list.forEach((item: unknown, index) => {
    const row = `${path}.${index + 1}`;
    if (!isObject(item)) {
      builder.skip(file, row, "The comment is not an object.");
      return;
    }
    addJsonComment(builder, file, row, item, shape, { postKey, parentKey });
  });
}

export function addJsonComment(
  builder: RecordsBuilder,
  file: string,
  row: string,
  item: Record<string, unknown>,
  shape: JsonShape,
  defaults: { readonly postKey: string | null; readonly parentKey: string | null },
): void {
  const sourceKey = asText(pick(item, shape.commentIds)) ?? `${file}#${row}`;
  const postKey = asText(pick(item, shape.commentPost)) ?? defaults.postKey;
  const parentKey = asText(pick(item, shape.commentParent)) ?? defaults.parentKey;
  builder.addComment({
    file,
    row,
    sourceKey,
    postKey,
    parentKey,
    body: bodyOf(item, shape),
    author: authorOf(item, shape),
    createdAt: parseDate(pick(item, shape.createdAt)),
    updatedAt: parseDate(pick(item, shape.updatedAt)),
  });
  addComments(builder, file, pick(item, shape.replies), shape, postKey, sourceKey, row);
}

export function addJsonPost(
  builder: RecordsBuilder,
  file: string,
  index: number,
  item: unknown,
  shape: JsonShape,
): void {
  const row = `item ${index + 1}`;
  if (!isObject(item)) {
    builder.skip(file, row, "The post is not an object.");
    return;
  }
  const keys = [pick(item, shape.ids), ...shape.postKeys.map((key) => pick(item, [key]))]
    .map(asText)
    .filter((key): key is string => key !== null);
  const primary = keys[0] ?? `${file}#${row}`;
  builder.addPost({
    file,
    row,
    sourceKeys: keys.length > 0 ? keys : [primary],
    title: asText(pick(item, shape.title)),
    body: bodyOf(item, shape),
    author: authorOf(item, shape),
    category: categoryOf(item, shape),
    createdAt: parseDate(pick(item, shape.createdAt)),
    updatedAt: parseDate(pick(item, shape.updatedAt)),
    pinned: flag(pick(item, shape.pinned)),
  });
  addComments(builder, file, pick(item, shape.comments), shape, primary, null, row);
}
