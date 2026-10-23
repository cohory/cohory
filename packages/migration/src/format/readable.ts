import { contentDocumentSchema, extractPlainText } from "@cohory/content";

import { csvRow } from "./csv";
import type { ArchiveRecords } from "./records";

export const readmePath = "README.txt";
export const spreadsheetsFolder = "spreadsheets/";
export const spreadsheetPaths = ["members.csv", "posts.csv", "comments.csv"].map(
  (name) => `${spreadsheetsFolder}${name}`,
);

const encoder = new TextEncoder();

function plainText(body: unknown): string {
  const parsed = contentDocumentSchema.safeParse(body);
  return parsed.success ? extractPlainText(parsed.data) : "";
}

function sheet(header: readonly string[], rows: readonly (string | number | null)[][]): Uint8Array {
  return encoder.encode(`\uFEFF${[header, ...rows].map(csvRow).join("")}`);
}

function readme(name: string, exportedAt: string): string {
  return `${name}, exported ${exportedAt.slice(0, 10)} (UTC)

This zip is a Cohory archive. Another Cohory server can import it. You can also
read it without Cohory:

spreadsheets/members.csv   Every member: email, name, username, role, status, and join date.
spreadsheets/posts.csv     Every post that was not deleted, as plain text, with author and category.
spreadsheets/comments.csv  Every comment that was not deleted, as plain text, with its post.

The spreadsheets are copies for reading. Cohory imports the data files, not the spreadsheets.

data/*.jsonl    One JSON object per line for each kind of record: members, posts, comments,
                courses, lessons, events, points, and more. Formatted text is kept here.
uploads/        Images and files used in posts, courses, and the About page.
manifest.json   The format version, counts, and a checksum for every file.

Passwords and payment card details are never part of an archive.
The format is documented in docs/architecture/archive-format.md in the Cohory repository.
`;
}

export function readableCopies(
  records: ArchiveRecords,
  meta: { readonly name: string; readonly exportedAt: string },
): Record<string, Uint8Array> {
  const users = new Map(records.users.map((user) => [user.id, user]));
  const categories = new Map(records.categories.map((category) => [category.id, category.name]));
  const author = (id: string): [string, string] => {
    const user = users.get(id);
    return user ? [user.name, user.erased ? "" : user.email] : ["", ""];
  };
  return {
    [readmePath]: encoder.encode(readme(meta.name, meta.exportedAt)),
    [`${spreadsheetsFolder}members.csv`]: sheet(
      ["email", "name", "username", "role", "status", "joined_at"],
      records.memberships.map((row) => {
        const user = users.get(row.userId);
        return [
          user && !user.erased ? user.email : "",
          user?.name ?? "",
          user?.username ?? "",
          row.role,
          row.status,
          row.joinedAt,
        ];
      }),
    ),
    [`${spreadsheetsFolder}posts.csv`]: sheet(
      ["id", "created_at", "author_name", "author_email", "category", "title", "text", "pinned"],
      records.posts
        .filter((row) => !row.deletedAt)
        .map((row) => [
          row.id,
          row.createdAt,
          ...author(row.authorId),
          row.categoryId ? (categories.get(row.categoryId) ?? "") : "",
          row.title,
          plainText(row.body),
          row.pinnedAt ? "yes" : "no",
        ]),
    ),
    [`${spreadsheetsFolder}comments.csv`]: sheet(
      ["id", "post_id", "parent_id", "created_at", "author_name", "author_email", "text"],
      records.comments
        .filter((row) => !row.deletedAt)
        .map((row) => [
          row.id,
          row.postId,
          row.parentId,
          row.createdAt,
          ...author(row.authorId),
          plainText(row.body),
        ]),
    ),
  };
}
