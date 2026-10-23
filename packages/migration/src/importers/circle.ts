import { MigrationError } from "../errors";
import { RecordsBuilder, type AuthorRef, type MemberRole } from "./builder";
import { importerCatalog } from "./catalog";
import { addJsonComment, addJsonPost, type JsonShape } from "./json-content";
import { plainOrHtmlToDocument } from "./rich-text";
import {
  csvHeaderKeys,
  CsvTable,
  decodeText,
  hasAny,
  isObject,
  jsonArray,
  parseDate,
  parseFlag,
  pick,
  readJson,
} from "./tabular";
import type { DetectedFile, Importer, ImportFile } from "./types";

const member = {
  id: ["UID", "ID", "Member ID", "Community member ID"],
  firstName: ["First name"],
  lastName: ["Last name"],
  name: ["Name", "Full name"],
  email: ["Email", "Email address"],
  joined: ["Join date", "Joined at", "Date joined", "Joined", "Created at"],
  lastActive: ["Last active", "Last active at", "Last seen at", "Last seen"],
  bio: ["Headline", "Bio"],
  profileUrl: ["Profile URL"],
  isMember: ["Member"],
  role: ["Role"],
  admin: ["Admin"],
  moderator: ["Moderator"],
  paywalls: ["Paywalls", "Paywall", "Plan", "Plans", "Subscription", "Subscriptions"],
  ignored: [
    "Active",
    "Active status",
    "Tags",
    "Avatar URL",
    "Posts",
    "Posts count",
    "Comments",
    "Comments count",
    "Likes received",
    "Activity score",
    "Email marketing",
    "Email marketing preference",
    "Invitation status",
    "Invitation date",
  ],
} as const;

const body = ["Body", "Body html", "Content", "HTML"] as const;
const author = {
  email: ["Author email", "User email", "Member email"],
  id: ["Author ID", "User ID", "Community member ID", "Member ID"],
  name: ["Author name", "User name", "Member name"],
} as const;

const space = {
  id: ["ID"],
  name: ["Name"],
  ignored: ["Slug", "Privacy", "Visibility", "Post count", "Posts count"],
} as const;

const post = {
  id: ["ID"],
  spaceId: ["Space ID"],
  spaceName: ["Space name", "Space"],
  title: ["Title", "Name"],
  createdAt: ["Created at", "Published at"],
  updatedAt: ["Updated at"],
  pinned: ["Pinned", "Is pinned"],
  ignored: ["Slug", "Comments count", "Likes count", "URL"],
} as const;

const comment = {
  id: ["ID"],
  postId: ["Post ID"],
  parentId: ["Parent comment ID", "Parent ID"],
  createdAt: ["Created at"],
  updatedAt: ["Updated at"],
  ignored: ["Space ID", "Likes count"],
} as const;

export const circleShape: JsonShape = {
  ids: ["id"],
  commentIds: ["id"],
  postKeys: [],
  title: ["name", "title"],
  html: ["body_html", "html", "body", "tiptap_body"],
  text: ["body_plain_text", "text", "content"],
  textIs: "html",
  author: ["author", "community_member", "user"],
  authorName: ["user_name", "author_name", "member_name"],
  authorEmail: ["user_email", "author_email", "member_email"],
  authorHandle: ["profile_url"],
  authorId: ["community_member_id", "user_id", "author_id"],
  category: ["space_name", "space"],
  createdAt: ["created_at", "published_at"],
  updatedAt: ["updated_at"],
  pinned: ["is_pinned", "pinned"],
  comments: ["comments"],
  replies: ["replies"],
  commentPost: ["post_id"],
  commentParent: ["parent_comment_id", "parent_id"],
};

const labels = {
  members: "Members CSV",
  spaces: "Spaces CSV",
  posts: "Posts CSV",
  comments: "Comments CSV",
  postsJson: "Posts JSON",
  commentsJson: "Comments JSON",
} as const;

type CircleKind = keyof typeof labels;

const order: readonly CircleKind[] = [
  "members",
  "spaces",
  "posts",
  "postsJson",
  "comments",
  "commentsJson",
];

function detected(file: ImportFile, kind: CircleKind | null): DetectedFile {
  return { name: file.name, kind, label: kind ? labels[kind] : "Not a Circle file" };
}

function detectCsv(keys: ReadonlySet<string>): CircleKind | null {
  const hasBody = hasAny(keys, body);
  if (keys.has("email") && !hasBody) {
    return hasAny(keys, [
      "UID",
      "Activity score",
      "Tags",
      "Invitation status",
      "Member",
      "Headline",
    ])
      ? "members"
      : null;
  }
  if (hasBody && hasAny(keys, post.title) && hasAny(keys, [...post.spaceId, ...post.spaceName])) {
    return "posts";
  }
  if (hasBody && hasAny(keys, comment.postId)) return "comments";
  if (keys.has("id") && keys.has("name") && hasAny(keys, space.ignored)) return "spaces";
  return null;
}

function detectJson(file: ImportFile): CircleKind | null {
  let value: unknown;
  try {
    value = readJson(file);
  } catch {
    return null;
  }
  const first = jsonArray(value, ["records", "posts", "comments", "data"])?.find(isObject);
  if (!first) return null;
  if (pick(first, [...circleShape.html, ...circleShape.text]) === undefined) return null;
  if (pick(first, circleShape.commentPost) !== undefined) return "commentsJson";
  if (pick(first, circleShape.title) !== undefined) return "postsJson";
  return null;
}

function roleOf(table: CsvTable, row: readonly string[], warn: (m: string) => void): MemberRole {
  const role = table.get(row, member.role)?.toLowerCase() ?? null;
  if (role === "admin" || role === "administrator" || role === "owner") return "admin";
  if (role === "moderator") return "moderator";
  if (role !== null && role !== "member") {
    warn("Some roles are not admin, moderator, or member. Those people join as members.");
  }
  if (parseFlag(table.get(row, member.admin))) return "admin";
  if (parseFlag(table.get(row, member.moderator))) return "moderator";
  return "member";
}

function sourceRoleOf(table: CsvTable, row: readonly string[]): string | null {
  const role = table.get(row, member.role);
  if (role) return role;
  if (parseFlag(table.get(row, member.admin))) return "Admin column";
  if (parseFlag(table.get(row, member.moderator))) return "Moderator column";
  return null;
}

function onPaywall(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized !== "" && !["no", "none", "free", "-"].includes(normalized);
}

function readMembers(builder: RecordsBuilder, file: ImportFile): number {
  const table = new CsvTable(file.name, decodeText(file));
  builder.unknownColumns(file.name, table.unknownColumns(Object.values(member)));
  const warn = (message: string) => builder.warn(message);
  const dateOrder = table.dateOrder([...member.joined, ...member.lastActive]) ?? undefined;
  if (table.has(member.paywalls)) {
    builder.warn("Paywalls are not imported. Paid access does not transfer.");
  }
  builder.noteDateOrder(dateOrder ?? null);
  table.rows.forEach((row, offset) => {
    const line = `line ${offset + 2}`;
    const values = table.record(row);
    if (parseFlag(table.get(row, member.isMember)) === false) {
      builder.skip(file.name, line, "This person was invited but did not join.", values);
      return;
    }
    const first = table.get(row, member.firstName);
    const last = table.get(row, member.lastName);
    const id = table.get(row, member.id);
    const profileUrl = table.get(row, member.profileUrl);
    const rawJoined = table.get(row, member.joined);
    const joinedAt = parseDate(rawJoined, dateOrder);
    if (rawJoined && !joinedAt) {
      builder.warn("Some join dates could not be read. Those members joined at the import time.");
    }
    builder.addMember({
      file: file.name,
      row: line,
      email: table.get(row, member.email),
      name: [first, last].filter(Boolean).join(" ") || table.get(row, member.name),
      sourceIds: [id, profileUrl].filter((value): value is string => value !== null),
      role: roleOf(table, row, warn),
      sourceRole: sourceRoleOf(table, row),
      joinedAt,
      lastSeenAt: parseDate(table.get(row, member.lastActive), dateOrder),
      bio: table.get(row, member.bio),
      joinAnswers: [],
      points: null,
      wasPaying: onPaywall(table.get(row, member.paywalls)),
      values,
    });
  });
  return table.rows.length;
}

function readSpaces(builder: RecordsBuilder, file: ImportFile, spaces: Map<string, string>) {
  const table = new CsvTable(file.name, decodeText(file));
  builder.unknownColumns(file.name, table.unknownColumns(Object.values(space)));
  for (const row of table.rows) {
    const id = table.get(row, space.id);
    const name = table.get(row, space.name);
    if (id && name) spaces.set(id, name);
  }
  return table.rows.length;
}

function authorFrom(table: CsvTable, row: readonly string[]): AuthorRef {
  return {
    email: table.get(row, author.email),
    id: table.get(row, author.id),
    name: table.get(row, author.name),
  };
}

function readPosts(builder: RecordsBuilder, file: ImportFile, spaces: ReadonlyMap<string, string>) {
  const table = new CsvTable(file.name, decodeText(file));
  builder.unknownColumns(
    file.name,
    table.unknownColumns([...Object.values(post), body, ...Object.values(author)]),
  );
  const dateOrder = table.dateOrder([...post.createdAt, ...post.updatedAt]) ?? undefined;
  builder.noteDateOrder(dateOrder ?? null);
  table.rows.forEach((row, offset) => {
    const line = `line ${offset + 2}`;
    const id = table.get(row, post.id);
    const spaceId = table.get(row, post.spaceId);
    builder.addPost({
      file: file.name,
      row: line,
      sourceKeys: [id ?? `${file.name}#${line}`],
      title: table.get(row, post.title),
      body: plainOrHtmlToDocument(table.get(row, body) ?? ""),
      author: authorFrom(table, row),
      category: (spaceId ? spaces.get(spaceId) : undefined) ?? table.get(row, post.spaceName),
      createdAt: parseDate(table.get(row, post.createdAt), dateOrder),
      updatedAt: parseDate(table.get(row, post.updatedAt), dateOrder),
      pinned: parseFlag(table.get(row, post.pinned)) === true,
    });
  });
  return table.rows.length;
}

function readComments(builder: RecordsBuilder, file: ImportFile): number {
  const table = new CsvTable(file.name, decodeText(file));
  builder.unknownColumns(
    file.name,
    table.unknownColumns([...Object.values(comment), body, ...Object.values(author)]),
  );
  const dateOrder = table.dateOrder([...comment.createdAt, ...comment.updatedAt]) ?? undefined;
  builder.noteDateOrder(dateOrder ?? null);
  table.rows.forEach((row, offset) => {
    const line = `line ${offset + 2}`;
    builder.addComment({
      file: file.name,
      row: line,
      sourceKey: table.get(row, comment.id),
      postKey: table.get(row, comment.postId),
      parentKey: table.get(row, comment.parentId),
      body: plainOrHtmlToDocument(table.get(row, body) ?? ""),
      author: authorFrom(table, row),
      createdAt: parseDate(table.get(row, comment.createdAt), dateOrder),
      updatedAt: parseDate(table.get(row, comment.updatedAt), dateOrder),
    });
  });
  return table.rows.length;
}

function readJsonItems(file: ImportFile): unknown[] {
  const items = jsonArray(readJson(file), ["records", "posts", "comments", "data"]);
  if (!items) throw new MigrationError("invalid_csv", `${file.name} does not hold a list.`);
  return items;
}

export const circleImporter: Importer = {
  id: "circle",
  name: importerCatalog.circle.name,
  version: importerCatalog.circle.version,
  accept: importerCatalog.circle.accept,

  detect(file) {
    const header = csvHeaderKeys(file);
    if (header) return detected(file, detectCsv(header));
    if (file.name.toLowerCase().endsWith(".json")) return detected(file, detectJson(file));
    return detected(file, null);
  },

  parse(files, context) {
    const builder = new RecordsBuilder("circle", context);
    const spaces = new Map<string, string>();
    const rank = (kind: string | null) => {
      const index = order.findIndex((entry) => entry === kind);
      return index === -1 ? order.length : index;
    };
    const sorted = files
      .map((file) => ({ file, detection: circleImporter.detect(file) }))
      .sort((a, b) => rank(a.detection.kind) - rank(b.detection.kind));
    for (const { file, detection } of sorted) {
      try {
        switch (detection.kind) {
          case "members":
            builder.file(detection, readMembers(builder, file));
            break;
          case "spaces":
            builder.file(detection, readSpaces(builder, file, spaces));
            break;
          case "posts":
            builder.file(detection, readPosts(builder, file, spaces));
            break;
          case "comments":
            builder.file(detection, readComments(builder, file));
            break;
          case "postsJson": {
            const items = readJsonItems(file);
            items.forEach((item, index) =>
              addJsonPost(builder, file.name, index, item, circleShape),
            );
            builder.file(detection, items.length);
            break;
          }
          case "commentsJson": {
            const items = readJsonItems(file);
            items.forEach((item, index) => {
              const row = `item ${index + 1}`;
              if (!isObject(item)) {
                builder.skip(file.name, row, "The comment is not an object.");
                return;
              }
              addJsonComment(builder, file.name, row, item, circleShape, {
                postKey: null,
                parentKey: null,
              });
            });
            builder.file(detection, items.length);
            break;
          }
          default:
            builder.file(detection, 0);
            builder.warn(`${file.name} is not a file this importer reads. It was left out.`);
        }
      } catch (error: unknown) {
        if (!(error instanceof MigrationError)) throw error;
        builder.file({ ...detection, kind: null, label: "Could not be read" }, 0);
        builder.warn(`${file.name} could not be read: ${error.message}`);
      }
    }
    return builder.build();
  },
};
