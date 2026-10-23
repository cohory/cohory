import { z } from "zod";

import { PostValidationError } from "./errors";
import {
  feedSorts,
  type CommentCursor,
  type FeedCursor,
  type FeedSort,
  type PostRecord,
} from "./repository";

const feedCursorSchema = z.strictObject({
  s: z.enum(feedSorts),
  p: z.iso.datetime().nullable(),
  k: z.int().nullable(),
  a: z.iso.datetime(),
  i: z.uuid(),
});

export const topCommentWeight = 2;

export function topScore(post: Pick<PostRecord, "likeCount" | "commentCount">): number {
  return post.likeCount + topCommentWeight * post.commentCount;
}

export function feedCursorOf(sort: FeedSort, post: PostRecord): FeedCursor {
  return {
    sort,
    pinnedAt: post.pinnedAt,
    score: sort === "top" ? topScore(post) : null,
    at: sort === "active" ? post.lastActivityAt : post.createdAt,
    id: post.id,
  };
}

const commentCursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode<T>(raw: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new PostValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return parsed.data;
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return encode({
    s: cursor.sort,
    p: cursor.pinnedAt?.toISOString() ?? null,
    k: cursor.score,
    a: cursor.at.toISOString(),
    i: cursor.id,
  });
}

export function decodeFeedCursor(raw: string, sort: FeedSort): FeedCursor {
  const { s, p, k, a, i } = decode(raw, feedCursorSchema);
  if (s !== sort || (s === "top") !== (k !== null)) {
    throw new PostValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return { sort: s, pinnedAt: p ? new Date(p) : null, score: k, at: new Date(a), id: i };
}

export function encodeCommentCursor(cursor: CommentCursor): string {
  return encode({ c: cursor.createdAt.toISOString(), i: cursor.id });
}

export function decodeCommentCursor(raw: string): CommentCursor {
  const { c, i } = decode(raw, commentCursorSchema);
  return { createdAt: new Date(c), id: i };
}
