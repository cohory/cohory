import type { PutObjectInput, StorageDriver } from "./driver";
import { parseStorageKey, type StorageKey } from "./keys";

export const imageVariantWidths = [160, 640, 1280, 1920] as const;
export type ImageVariantWidth = (typeof imageVariantWidths)[number];

export type ResizableFormat = "png" | "jpg" | "webp";

export interface ProcessedImage {
  readonly original: Uint8Array;
  readonly variants: readonly { readonly width: ImageVariantWidth; readonly body: Uint8Array }[];
}

export type ImageProcessor = (
  bytes: Uint8Array,
  format: ResizableFormat,
) => Promise<ProcessedImage>;

export interface PreparedImage {
  readonly key: StorageKey;
  readonly objects: readonly PutObjectInput[];
  readonly bytes: number;
}

const sizedOriginal = /\.sized\.(png|jpg|webp)$/;
const resizable = /\.(png|jpg|webp)$/;
const variantSuffix = new RegExp(`\\.w(${imageVariantWidths.join("|")})\\.webp$`);

function variantOf(sized: string, width: ImageVariantWidth): string {
  return sized.replace(sizedOriginal, `.w${width}.webp`);
}

function resizableFormat(key: string): ResizableFormat | null {
  const extension = resizable.exec(key)?.[1];
  return extension === "png" || extension === "jpg" || extension === "webp" ? extension : null;
}

export function isImageVariantKey(key: string): boolean {
  return variantSuffix.test(key);
}

export function storedImageKeys(key: StorageKey): StorageKey[] {
  if (!sizedOriginal.test(key)) {
    return [key];
  }
  return [key, ...imageVariantWidths.map((width) => parseStorageKey(variantOf(key, width)))];
}

export function imageSrcSetFromUrl(url: string): string | null {
  if (!sizedOriginal.test(url)) {
    return null;
  }
  return imageVariantWidths.map((width) => `${variantOf(url, width)} ${width}w`).join(", ");
}

export async function prepareImage(
  input: PutObjectInput,
  process: ImageProcessor | null,
): Promise<PreparedImage> {
  const format = resizableFormat(input.key);
  if (!process || !format) {
    return { key: input.key, objects: [input], bytes: input.body.byteLength };
  }
  const { original, variants } = await process(input.body, format);
  const key = parseStorageKey(input.key.replace(resizable, ".sized.$1"));
  const objects: PutObjectInput[] = [
    ...variants.map(({ width, body }) => ({
      key: parseStorageKey(variantOf(key, width)),
      body,
      contentType: "image/webp",
    })),
    { ...input, key, body: original },
  ];
  return {
    key,
    objects,
    bytes: objects.reduce((total, object) => total + object.body.byteLength, 0),
  };
}

export async function storePreparedImage(
  driver: Pick<StorageDriver, "put" | "delete">,
  prepared: PreparedImage,
): Promise<StorageKey> {
  const stored: StorageKey[] = [];
  try {
    for (const object of prepared.objects) {
      await driver.put(object);
      stored.push(object.key);
    }
    return prepared.key;
  } catch (error: unknown) {
    await Promise.allSettled(stored.map((key) => driver.delete(key)));
    throw error;
  }
}
