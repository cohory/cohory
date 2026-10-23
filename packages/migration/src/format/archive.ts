import { createHash } from "node:crypto";

import { isStorageKey } from "@cohory/storage";
import { unzipSync, zipSync, type Zippable } from "fflate";
import type { z } from "zod";

import { invalidArchive, MigrationError, type MigrationIssue } from "../errors";
import {
  archiveFormat,
  cohoryVersion,
  isSupportedSchemaVersion,
  manifestSchema,
  parts,
  schemaVersion,
  type Manifest,
} from "./manifest";
import {
  archiveEntities,
  entitiesAddedIn,
  entityPath,
  entitySchemas,
  type ArchiveEntity,
  type ArchiveRecords,
} from "./records";
import { readableCopies, readmePath, spreadsheetPaths } from "./readable";

export const manifestPath = "manifest.json";
export const uploadsFolder = "uploads/";

export interface ArchiveMeta {
  readonly edition: Manifest["edition"];
  readonly exportedAt: Date;
  readonly community: Manifest["community"];
  readonly missingUploads: readonly string[];
}

export interface ArchiveContents {
  readonly meta: ArchiveMeta;
  readonly records: ArchiveRecords;
  readonly uploads: ReadonlyMap<string, Uint8Array>;
}

export interface ParsedArchive {
  readonly manifest: Manifest;
  readonly records: ArchiveRecords;
  readonly uploads: ReadonlyMap<string, Uint8Array>;
}

export interface ReadLimits {
  readonly maxBytes: number;
  readonly maxUploadBytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxIssues = 20;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonLines(rows: readonly unknown[]): Uint8Array {
  return encoder.encode(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

export function writeArchive(contents: ArchiveContents): Uint8Array {
  const files: Manifest["files"] = [];
  const zippable: Zippable = {};
  const counts: Record<string, number> = {};
  for (const entity of archiveEntities) {
    const rows = contents.records[entity];
    const bytes = jsonLines(rows);
    const path = entityPath(entity);
    counts[entity] = rows.length;
    files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    zippable[path] = [bytes, { level: 6 }];
  }
  const exportedAt = contents.meta.exportedAt.toISOString();
  const copies = readableCopies(contents.records, {
    name: contents.meta.community.name,
    exportedAt,
  });
  for (const [path, bytes] of Object.entries(copies)) {
    files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    zippable[path] = [bytes, { level: 6 }];
  }
  let uploadBytes = 0;
  for (const [key, bytes] of [...contents.uploads].sort(([a], [b]) => a.localeCompare(b))) {
    const path = `${uploadsFolder}${key}`;
    uploadBytes += bytes.byteLength;
    files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    zippable[path] = [bytes, { level: 0 }];
  }
  const manifest: Manifest = {
    format: archiveFormat,
    schemaVersion,
    cohoryVersion,
    edition: contents.meta.edition,
    exportedAt,
    community: contents.meta.community,
    counts,
    uploads: { count: contents.uploads.size, bytes: uploadBytes },
    missingUploads: [...contents.meta.missingUploads],
    files,
  };
  zippable[manifestPath] = [encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), { level: 6 }];
  return zipSync(zippable);
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment !== ".." && segment !== ".")
  );
}

const dataPaths = new Set([...archiveEntities.map(entityPath), readmePath, ...spreadsheetPaths]);

function isKnownPath(path: string): boolean {
  if (path === manifestPath || dataPaths.has(path)) {
    return true;
  }
  return path.startsWith(uploadsFolder) && isStorageKey(path.slice(uploadsFolder.length));
}

function unzip(bytes: Uint8Array, limits: ReadLimits): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith("/")) {
          return false;
        }
        if (!isSafePath(file.name) || !isKnownPath(file.name)) {
          throw invalidArchive(`The archive holds a file that is not allowed: ${file.name}`);
        }
        const isUpload = file.name.startsWith(uploadsFolder);
        if (isUpload && file.originalSize > limits.maxUploadBytes) {
          throw new MigrationError("archive_too_large", `${file.name} is larger than allowed.`);
        }
        total += file.originalSize;
        if (total > limits.maxBytes * 2) {
          throw new MigrationError("archive_too_large", "The archive unpacks to too much data.");
        }
        return true;
      },
    });
  } catch (error: unknown) {
    if (error instanceof MigrationError) {
      throw error;
    }
    throw invalidArchive("The file is not a readable zip archive.");
  }
}

function parseManifest(entries: Record<string, Uint8Array>): Manifest {
  const raw = entries[manifestPath];
  if (!raw) {
    throw invalidArchive("The archive has no manifest.json.", manifestPath);
  }
  let json: unknown;
  try {
    json = JSON.parse(decoder.decode(raw));
  } catch {
    throw invalidArchive("manifest.json is not valid JSON.", manifestPath);
  }
  const format = manifestSchema.shape.format.safeParse(
    typeof json === "object" && json !== null && "format" in json ? json.format : undefined,
  );
  if (!format.success) {
    throw invalidArchive("This is not a Cohory archive.", manifestPath);
  }
  const version =
    typeof json === "object" && json !== null && "schemaVersion" in json
      ? String(json.schemaVersion)
      : "";
  if (!isSupportedSchemaVersion(version)) {
    throw new MigrationError(
      "unsupported_schema_version",
      `This archive uses format ${version || "unknown"}. This instance reads ${schemaVersion} and older 1.x archives.`,
    );
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new MigrationError(
      "invalid_archive",
      "manifest.json is not valid.",
      parsed.error.issues.slice(0, maxIssues).map((issue) => ({
        path: `${manifestPath}:${issue.path.join(".")}`,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function verifyFiles(manifest: Manifest, entries: Record<string, Uint8Array>): void {
  const listed = new Map(manifest.files.map((file) => [file.path, file]));
  for (const path of Object.keys(entries)) {
    if (path !== manifestPath && !listed.has(path)) {
      throw new MigrationError("checksum_mismatch", `${path} is not listed in the manifest.`);
    }
  }
  for (const file of manifest.files) {
    const bytes = entries[file.path];
    if (!bytes) {
      throw new MigrationError("checksum_mismatch", `${file.path} is missing from the archive.`);
    }
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new MigrationError("checksum_mismatch", `${file.path} does not match its checksum.`);
    }
  }
}

function parseLines<S extends z.ZodType>(
  path: string,
  bytes: Uint8Array | undefined,
  schema: S,
  issues: MigrationIssue[],
): z.output<S>[] {
  if (!bytes) {
    issues.push({ path, message: "The file is missing." });
    return [];
  }
  let textContent: string;
  try {
    textContent = decoder.decode(bytes);
  } catch {
    issues.push({ path, message: "The file is not UTF-8 text." });
    return [];
  }
  const rows: z.output<S>[] = [];
  const lines = textContent.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line === "" && index === lines.length - 1) {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      issues.push({ path: `${path}:${index + 1}`, message: "The line is not valid JSON." });
      continue;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issues.push({
        path: `${path}:${index + 1}${first?.path.length ? `:${first.path.join(".")}` : ""}`,
        message: first?.message ?? "The line is not valid.",
      });
      continue;
    }
    rows.push(parsed.data);
  }
  return rows;
}

function isOlderThan(version: string, addedIn: string | undefined): boolean {
  if (!addedIn) return false;
  const [major, minor, patch] = parts(version);
  const [addedMajor, addedMinor, addedPatch] = parts(addedIn);
  return (major - addedMajor || minor - addedMinor || patch - addedPatch) < 0;
}

export function readArchive(bytes: Uint8Array, limits: ReadLimits): ParsedArchive {
  if (bytes.byteLength > limits.maxBytes) {
    throw new MigrationError(
      "archive_too_large",
      "The archive is larger than this instance allows.",
    );
  }
  const entries = unzip(bytes, limits);
  const manifest = parseManifest(entries);
  verifyFiles(manifest, entries);
  const issues: MigrationIssue[] = [];
  const read = <S extends z.ZodType>(entity: ArchiveEntity, schema: S): z.output<S>[] => {
    const bytes = entries[entityPath(entity)];
    if (!bytes && isOlderThan(manifest.schemaVersion, entitiesAddedIn[entity])) {
      return [];
    }
    return parseLines(entityPath(entity), bytes, schema, issues);
  };
  const records: ArchiveRecords = {
    community: read("community", entitySchemas.community),
    community_gallery: read("community_gallery", entitySchemas.community_gallery),
    users: read("users", entitySchemas.users),
    memberships: read("memberships", entitySchemas.memberships),
    categories: read("categories", entitySchemas.categories),
    posts: read("posts", entitySchemas.posts),
    post_images: read("post_images", entitySchemas.post_images),
    comments: read("comments", entitySchemas.comments),
    reactions: read("reactions", entitySchemas.reactions),
    courses: read("courses", entitySchemas.courses),
    course_modules: read("course_modules", entitySchemas.course_modules),
    lessons: read("lessons", entitySchemas.lessons),
    lesson_progress: read("lesson_progress", entitySchemas.lesson_progress),
    lesson_agent_layers: read("lesson_agent_layers", entitySchemas.lesson_agent_layers),
    course_agent_versions: read("course_agent_versions", entitySchemas.course_agent_versions),
    course_agent_settings: read("course_agent_settings", entitySchemas.course_agent_settings),
    events: read("events", entitySchemas.events),
    event_occurrences: read("event_occurrences", entitySchemas.event_occurrences),
    event_rsvps: read("event_rsvps", entitySchemas.event_rsvps),
    points_ledger: read("points_ledger", entitySchemas.points_ledger),
    member_stats: read("member_stats", entitySchemas.member_stats),
    membership_plans: read("membership_plans", entitySchemas.membership_plans),
    subscriptions: read("subscriptions", entitySchemas.subscriptions),
    comped_memberships: read("comped_memberships", entitySchemas.comped_memberships),
    invite_links: read("invite_links", entitySchemas.invite_links),
    membership_requests: read("membership_requests", entitySchemas.membership_requests),
    reviews: read("reviews", entitySchemas.reviews),
    review_replies: read("review_replies", entitySchemas.review_replies),
    audit_log: read("audit_log", entitySchemas.audit_log),
  };
  for (const entity of archiveEntities) {
    const expected = manifest.counts[entity] ?? 0;
    if (records[entity].length !== expected && issues.length === 0) {
      issues.push({
        path: entityPath(entity),
        message: `The manifest counts ${expected} lines, the file has ${records[entity].length}.`,
      });
    }
  }
  const [community] = records.community;
  if (records.community.length !== 1 || community?.id !== manifest.community.id) {
    issues.push({ path: entityPath("community"), message: "The archive must hold one community." });
  }
  if (issues.length > 0) {
    throw new MigrationError(
      "invalid_archive",
      "The archive has invalid data.",
      issues.slice(0, maxIssues),
    );
  }
  const uploads = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(entries)) {
    if (path.startsWith(uploadsFolder)) {
      uploads.set(path.slice(uploadsFolder.length), content);
    }
  }
  return { manifest, records, uploads };
}
