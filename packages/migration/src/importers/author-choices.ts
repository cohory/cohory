import { z } from "zod";

import { MigrationError } from "../errors";
import type { ArchiveRecords } from "../format/records";
import type { AmbiguousAuthor } from "./types";

export const authorChoicesSchema = z.record(z.string().max(64), z.string().max(64));

export type AuthorChoices = Readonly<z.infer<typeof authorChoicesSchema>>;

export function assertAuthorChoices(
  choices: AuthorChoices,
  ambiguous: readonly AmbiguousAuthor[],
): void {
  const allowed = new Map(
    ambiguous.map((entry) => [
      entry.placeholderId,
      new Set(entry.candidates.map((candidate) => candidate.id)),
    ]),
  );
  for (const [placeholderId, memberId] of Object.entries(choices)) {
    if (!allowed.get(placeholderId)?.has(memberId)) {
      throw new MigrationError("validation_failed", "Choose one of the listed members.", [
        { path: `authors.${placeholderId}`, message: "Choose one of the listed members." },
      ]);
    }
  }
}

export function applyAuthorChoices(
  records: ArchiveRecords,
  choices: AuthorChoices,
): ArchiveRecords {
  const chosen = new Map(Object.entries(choices));
  if (chosen.size === 0) return records;
  const author = (id: string) => chosen.get(id) ?? id;
  return {
    ...records,
    users: records.users.filter((user) => !chosen.has(user.id)),
    posts: records.posts.map((post) => ({ ...post, authorId: author(post.authorId) })),
    comments: records.comments.map((comment) => ({
      ...comment,
      authorId: author(comment.authorId),
    })),
  };
}
