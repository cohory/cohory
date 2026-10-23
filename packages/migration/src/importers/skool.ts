import { MigrationError } from "../errors";
import { pointsAtLevel, RecordsBuilder, type MemberRole } from "./builder";
import { importerCatalog } from "./catalog";
import { addJsonComment, addJsonPost, type JsonShape } from "./json-content";
import {
  csvHeaderKeys,
  CsvTable,
  decodeText,
  hasAny,
  isObject,
  jsonArray,
  parseDate,
  pick,
  readJson,
} from "./tabular";
import type { DetectedFile, Importer, ImportFile } from "./types";

const columns = {
  firstName: ["FirstName", "First name"],
  lastName: ["LastName", "Last name"],
  name: ["Name", "Full name"],
  email: ["Email", "Email address"],
  joined: ["JoinedDate", "Joined", "Join date", "Joined at"],
  points: ["Points"],
  level: ["Level"],
  role: ["Role"],
  bio: ["Bio"],
  price: ["Price"],
  tier: ["Tier"],
  ignored: ["Invited By", "Recurring Interval", "LTV"],
} as const;

const questionPattern = /^(question|answer)[1-3]$/;
const paymentColumns = ["Price", "Recurring Interval", "Tier", "LTV"] as const;

export const skoolShape: JsonShape = {
  ids: ["id", "post_id", "postId"],
  commentIds: ["id", "comment_id", "commentId"],
  postKeys: ["post_url", "url"],
  title: ["title", "name"],
  html: ["html", "body_html", "content_html"],
  text: ["content", "body", "text", "markdown"],
  textIs: "markdown",
  author: ["author", "user"],
  authorName: ["author_name", "author", "name"],
  authorEmail: ["author_email"],
  authorHandle: ["author_handle"],
  authorId: ["author_id"],
  category: ["category", "category_name"],
  createdAt: ["created_at", "posted_at", "published_at", "date"],
  updatedAt: ["updated_at", "edited_at"],
  pinned: ["pinned", "is_pinned"],
  comments: ["comments"],
  replies: ["replies", "children"],
  commentPost: ["post_id", "postId", "post_url", "postUrl"],
  commentParent: ["parent_id", "parentId", "parent_comment_id"],
};

const labels = {
  members: "Members CSV",
  posts: "Posts JSON",
  comments: "Comments JSON",
} as const;

type SkoolKind = keyof typeof labels;

function detected(file: ImportFile, kind: SkoolKind | null): DetectedFile {
  return { name: file.name, kind, label: kind ? labels[kind] : "Not a Skool file" };
}

function detectJson(file: ImportFile): SkoolKind | null {
  let value: unknown;
  try {
    value = readJson(file);
  } catch {
    return null;
  }
  const items = jsonArray(value, ["posts", "items", "data"]);
  const first = items?.find(isObject);
  if (!first) return null;
  const hasBody = pick(first, [...skoolShape.html, ...skoolShape.text]) !== undefined;
  if (!hasBody) return null;
  if (pick(first, skoolShape.title) !== undefined) return "posts";
  if (pick(first, skoolShape.commentPost) !== undefined) return "comments";
  return null;
}

function mapRole(value: string | null, warn: (message: string) => void): MemberRole {
  const role = value?.trim().toLowerCase() ?? "";
  if (role === "" || role === "member") return "member";
  if (role === "admin" || role === "administrator") return "admin";
  if (role === "moderator" || role === "mod") return "moderator";
  if (role === "owner" || role === "group owner" || role === "creator") return "admin";
  warn(`Some roles are not admin, moderator, or member. Those people join as members.`);
  return "member";
}

function wholeNumber(value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function wasPaying(price: number | null, tier: string | null): boolean {
  return (price ?? 0) > 0 || (tier !== null && tier.trim().toLowerCase() !== "free");
}

function readMembers(builder: RecordsBuilder, file: ImportFile): number {
  const table = new CsvTable(file.name, decodeText(file));
  builder.unknownColumns(
    file.name,
    table.unknownColumns(Object.values(columns), [questionPattern]),
  );
  if (paymentColumns.some((column) => table.has([column]))) {
    builder.warn(
      "Price, tier, and lifetime value are not imported. Paid access does not transfer.",
    );
  }
  if (!table.has(columns.points) && table.has(columns.level)) {
    builder.warn("The file has levels but no points. Members get the points of their level.");
  }
  const warn = (message: string) => builder.warn(message);
  const dateOrder = table.dateOrder(columns.joined);
  builder.noteDateOrder(dateOrder);
  table.rows.forEach((row, offset) => {
    const line = `line ${offset + 2}`;
    const first = table.get(row, columns.firstName);
    const last = table.get(row, columns.lastName);
    const rawJoined = table.get(row, columns.joined);
    const joinedAt = parseDate(rawJoined, dateOrder ?? undefined);
    if (rawJoined && !joinedAt) {
      builder.warn("Some join dates could not be read. Those members joined at the import time.");
    }
    const answers: string[] = [];
    for (const number of [1, 2, 3]) {
      const answer = table.get(row, [`Answer${number}`]);
      const question = table.get(row, [`Question${number}`]);
      if (answer) answers.push(question ? `${question}: ${answer}` : answer);
    }
    const points = wholeNumber(table.get(row, columns.points));
    const level = wholeNumber(table.get(row, columns.level));
    const sourceRole = table.get(row, columns.role);
    builder.addMember({
      file: file.name,
      row: line,
      email: table.get(row, columns.email),
      name: [first, last].filter(Boolean).join(" ") || table.get(row, columns.name),
      sourceIds: [],
      role: mapRole(sourceRole, warn),
      sourceRole,
      joinedAt,
      lastSeenAt: null,
      bio: table.get(row, columns.bio),
      joinAnswers: answers,
      points: points ?? (level !== null && level > 0 ? pointsAtLevel(level) : null),
      wasPaying: wasPaying(
        wholeNumber(table.get(row, columns.price)),
        table.get(row, columns.tier),
      ),
      values: table.record(row),
    });
  });
  return table.rows.length;
}

function readItems(file: ImportFile): unknown[] {
  const items = jsonArray(readJson(file), ["posts", "items", "data", "comments"]);
  if (!items) {
    throw new MigrationError("invalid_csv", `${file.name} does not hold a list.`);
  }
  return items;
}

export const skoolImporter: Importer = {
  id: "skool",
  name: importerCatalog.skool.name,
  version: importerCatalog.skool.version,
  accept: importerCatalog.skool.accept,

  detect(file) {
    const header = csvHeaderKeys(file);
    if (header) {
      const members =
        header.has("email") && hasAny(header, ["FirstName", "JoinedDate", "Invited By", "LTV"]);
      return detected(file, members ? "members" : null);
    }
    if (file.name.toLowerCase().endsWith(".json")) return detected(file, detectJson(file));
    return detected(file, null);
  },

  parse(files, context) {
    const builder = new RecordsBuilder("skool", context);
    const sorted = files
      .map((file) => ({ file, detection: skoolImporter.detect(file) }))
      .sort((a, b) => order(a.detection.kind) - order(b.detection.kind));
    for (const { file, detection } of sorted) {
      try {
        if (detection.kind === "members") {
          builder.file(detection, readMembers(builder, file));
        } else if (detection.kind === "posts") {
          const items = readItems(file);
          items.forEach((item, index) => addJsonPost(builder, file.name, index, item, skoolShape));
          builder.file(detection, items.length);
        } else if (detection.kind === "comments") {
          const items = readItems(file);
          items.forEach((item, index) => {
            const row = `item ${index + 1}`;
            if (!isObject(item)) {
              builder.skip(file.name, row, "The comment is not an object.");
              return;
            }
            addJsonComment(builder, file.name, row, item, skoolShape, {
              postKey: null,
              parentKey: null,
            });
          });
          builder.file(detection, items.length);
        } else {
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

function order(kind: string | null): number {
  return kind === "members" ? 0 : kind === "posts" ? 1 : kind === "comments" ? 2 : 3;
}
