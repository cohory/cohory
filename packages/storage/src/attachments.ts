import { z } from "zod";

import { StorageError } from "./errors";
import { sniffImageType } from "./images";
import {
  communityKey,
  communityPrefix,
  isStorageKey,
  type StorageKey,
  type StoragePrefix,
} from "./keys";

export const attachmentMaxBytes = 25 * 1024 * 1024;
export const attachmentNameMaxLength = 200;

const attachmentTypes = {
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
} as const;

export type AttachmentExtension = keyof typeof attachmentTypes;
export type AttachmentContentType = (typeof attachmentTypes)[AttachmentExtension];
export const attachmentExtensions = Object.keys(attachmentTypes) as AttachmentExtension[];

const extensionAliases: Readonly<Record<string, AttachmentExtension>> = { jpeg: "jpg" };

export interface AttachmentUpload {
  bytes: Uint8Array;
  name: string;
  declaredType: string;
}

export interface ValidatedAttachment {
  name: string;
  extension: AttachmentExtension;
  contentType: AttachmentContentType;
  size: number;
}

function isAttachmentExtension(value: string): value is AttachmentExtension {
  return Object.hasOwn(attachmentTypes, value);
}

function extensionOf(name: string): AttachmentExtension | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const raw = name.slice(dot + 1).toLowerCase();
  const extension = extensionAliases[raw] ?? raw;
  return isAttachmentExtension(extension) ? extension : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    utf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function bytesMatch(extension: AttachmentExtension, bytes: Uint8Array): boolean {
  switch (extension) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "zip":
      return (
        startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      );
    case "png":
      return sniffImageType(bytes) === "image/png";
    case "jpg":
      return sniffImageType(bytes) === "image/jpeg";
    case "md":
    case "txt":
    case "csv":
      return isPlainText(bytes);
  }
}

const unsafeRanges: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

function isSafeCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return !unsafeRanges.some(([low, high]) => code >= low && code <= high);
}

function displayName(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? "";
  const cleaned = Array.from(base).filter(isSafeCharacter).join("").trim();
  if (cleaned.length <= attachmentNameMaxLength) {
    return cleaned;
  }
  const suffix = cleaned.slice(cleaned.lastIndexOf("."));
  return `${cleaned.slice(0, attachmentNameMaxLength - suffix.length)}${suffix}`;
}

export function validateAttachment({
  bytes,
  name,
  declaredType,
}: AttachmentUpload): ValidatedAttachment {
  if (bytes.byteLength === 0) {
    throw new StorageError("unsupported_type", "The file is empty. Choose a file to upload.");
  }
  if (bytes.byteLength > attachmentMaxBytes) {
    throw new StorageError("file_too_large", "The file is over 25 MB. Choose a smaller file.");
  }
  const extension = extensionOf(name.trim());
  if (!extension) {
    throw new StorageError(
      "unsupported_type",
      "This file type is not supported. Use a PDF, ZIP, PNG, JPEG, Markdown, text, or CSV file.",
    );
  }
  const contentType = attachmentTypes[extension];
  const declaredBinary = !contentType.startsWith("text/") && declaredType !== contentType;
  if (declaredBinary || !bytesMatch(extension, bytes)) {
    throw new StorageError(
      "content_mismatch",
      "The file does not look like the type its name says. Choose another file.",
    );
  }
  const cleaned = displayName(name);
  return {
    name: cleaned.length > extension.length + 1 ? cleaned : `attachment.${extension}`,
    extension,
    contentType,
    size: bytes.byteLength,
  };
}

const uuid = z.uuid();

export function courseAttachmentKey(
  communityId: string,
  courseId: string,
  fileId: string,
  extension: AttachmentExtension,
): StorageKey {
  return communityKey(
    communityId,
    "courses",
    uuid.parse(courseId),
    "attachments",
    `${uuid.parse(fileId)}.${extension}`,
  );
}

const attachmentKeyPattern =
  /^communities\/([0-9a-f-]{36})\/courses\/([0-9a-f-]{36})\/attachments\/[0-9a-f-]{36}\.([a-z]+)$/;

export function isCourseAttachmentKey(key: string, communityId: string, courseId: string): boolean {
  if (!isStorageKey(key)) {
    return false;
  }
  const match = attachmentKeyPattern.exec(key);
  return (
    match !== null &&
    match[1] === communityId.toLowerCase() &&
    match[2] === courseId.toLowerCase() &&
    isAttachmentExtension(match[3] ?? "")
  );
}

export function courseAgentFileKey(
  communityId: string,
  courseId: string,
  fileId: string,
  extension: AttachmentExtension,
): StorageKey {
  return communityKey(
    communityId,
    "courses",
    uuid.parse(courseId),
    "agent",
    `${uuid.parse(fileId)}.${extension}`,
  );
}

export function courseAgentPrefix(communityId: string, courseId: string): StoragePrefix {
  return `${communityPrefix(communityId)}courses/${uuid.parse(courseId)}/agent/` as StoragePrefix;
}

const agentFileKeyPattern =
  /^communities\/([0-9a-f-]{36})\/courses\/([0-9a-f-]{36})\/agent\/[0-9a-f-]{36}\.([a-z]+)$/;

export function isCourseAgentFileKey(key: string, communityId: string, courseId: string): boolean {
  if (!isStorageKey(key)) {
    return false;
  }
  const match = agentFileKeyPattern.exec(key);
  return (
    match !== null &&
    match[1] === communityId.toLowerCase() &&
    match[2] === courseId.toLowerCase() &&
    isAttachmentExtension(match[3] ?? "")
  );
}
