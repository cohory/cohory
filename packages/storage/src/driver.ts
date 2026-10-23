import { contentTypeForKey, type StorageContentType } from "./content-types";
import { StorageError } from "./errors";
import type { StorageKey, StoragePrefix } from "./keys";

export interface PutObjectInput {
  key: StorageKey;
  body: Uint8Array;
  contentType: string;
}

export interface StoredObjectInfo {
  key: StorageKey;
  contentType: StorageContentType;
  size: number;
}

export interface StoredObjectSummary {
  key: StorageKey;
  size: number;
  lastModified: Date;
}

export interface StoredObject extends StoredObjectInfo {
  body: ReadableStream<Uint8Array>;
}

export interface StorageDriver {
  readonly kind: "local" | "s3";
  readonly maxBytes: number;
  put(input: PutObjectInput): Promise<StoredObjectInfo>;
  get(key: StorageKey): Promise<StoredObject | null>;
  delete(key: StorageKey): Promise<void>;
  publicUrl(key: StorageKey): string;
  usedBytes(prefix: StoragePrefix): Promise<number>;
  list(prefix: StoragePrefix): Promise<StoredObjectSummary[]>;
}

export function assertPutAllowed(input: PutObjectInput, maxBytes: number): StorageContentType {
  const contentType = contentTypeForKey(input.key);
  if (contentType === null) {
    throw new StorageError("unsupported_type", "This file type is not supported.");
  }
  if (contentType !== input.contentType) {
    throw new StorageError(
      "content_mismatch",
      "The file content type does not match its extension.",
    );
  }
  if (input.body.byteLength > maxBytes) {
    throw new StorageError("file_too_large", "The file is larger than the upload limit.");
  }
  return contentType;
}

export function joinUrl(base: string, key: StorageKey): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}
