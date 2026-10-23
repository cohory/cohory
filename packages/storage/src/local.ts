import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { contentTypeForKey } from "./content-types";
import {
  assertPutAllowed,
  joinUrl,
  type PutObjectInput,
  type StorageDriver,
  type StoredObject,
  type StoredObjectInfo,
  type StoredObjectSummary,
} from "./driver";
import { defaultMaxUploadBytes, defaultUploadsRoute } from "./env";
import { StorageError } from "./errors";
import { isStorageKey, parseStorageKey, type StorageKey, type StoragePrefix } from "./keys";

export interface LocalDriverOptions {
  root: string;
  maxBytes?: number;
  publicBaseUrl?: string;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function folderBytes(folder: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }
    throw error;
  }
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".tmp"))
      .map(async (entry) => {
        try {
          return (await stat(path.join(entry.parentPath, entry.name))).size;
        } catch (error) {
          if (isMissing(error)) {
            return 0;
          }
          throw error;
        }
      }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

export function createLocalDriver(options: LocalDriverOptions): StorageDriver {
  const root = path.resolve(options.root);
  const maxBytes = options.maxBytes ?? defaultMaxUploadBytes;
  const publicBaseUrl = options.publicBaseUrl ?? defaultUploadsRoute;

  function resolveKey(key: StorageKey): string {
    const target = path.resolve(root, parseStorageKey(key));
    if (!target.startsWith(root + path.sep)) {
      throw new StorageError("invalid_key", "The file key points outside the storage folder.");
    }
    return target;
  }

  return {
    kind: "local",
    maxBytes,

    async put(input: PutObjectInput): Promise<StoredObjectInfo> {
      const contentType = assertPutAllowed(input, maxBytes);
      const target = resolveKey(input.key);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, input.body, { flag: "wx" });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return { key: input.key, contentType, size: input.body.byteLength };
    },

    async get(key: StorageKey): Promise<StoredObject | null> {
      const target = resolveKey(key);
      const contentType = contentTypeForKey(key);
      if (contentType === null) {
        return null;
      }
      try {
        const info = await stat(target);
        if (!info.isFile()) {
          return null;
        }
        const body = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
        return { key, contentType, size: info.size, body };
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
    },

    async delete(key: StorageKey): Promise<void> {
      await rm(resolveKey(key), { force: true });
    },

    publicUrl(key: StorageKey): string {
      return joinUrl(publicBaseUrl, parseStorageKey(key));
    },

    async list(prefix: StoragePrefix): Promise<StoredObjectSummary[]> {
      const folder = path.resolve(root, prefix);
      if (!folder.startsWith(root + path.sep)) {
        throw new StorageError("invalid_key", "The prefix points outside the storage folder.");
      }
      let entries;
      try {
        entries = await readdir(folder, { withFileTypes: true, recursive: true });
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }
      const objects: StoredObjectSummary[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
        const full = path.join(entry.parentPath, entry.name);
        const key = path.relative(root, full).split(path.sep).join("/");
        if (!isStorageKey(key)) continue;
        try {
          const info = await stat(full);
          objects.push({ key, size: info.size, lastModified: info.mtime });
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
      return objects.sort((a, b) => a.key.localeCompare(b.key));
    },

    usedBytes(prefix: StoragePrefix): Promise<number> {
      const folder = path.resolve(root, prefix);
      if (!folder.startsWith(root + path.sep)) {
        throw new StorageError("invalid_key", "The prefix points outside the storage folder.");
      }
      return folderBytes(folder);
    },
  };
}
