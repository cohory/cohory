const contentTypesByExtension = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  zip: "application/zip",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
} as const;

export type StorageExtension = keyof typeof contentTypesByExtension;
export type StorageContentType = (typeof contentTypesByExtension)[StorageExtension];

function isStorageExtension(value: string): value is StorageExtension {
  return Object.hasOwn(contentTypesByExtension, value);
}

export function contentTypeForKey(key: string): StorageContentType | null {
  const dot = key.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const extension = key.slice(dot + 1).toLowerCase();
  return isStorageExtension(extension) ? contentTypesByExtension[extension] : null;
}
