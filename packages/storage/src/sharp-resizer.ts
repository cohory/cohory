import type { Sharp } from "sharp";

import { StorageError } from "./errors";
import { imageVariantWidths, type ImageProcessor, type ResizableFormat } from "./variants";

export const maxInputPixels = 25_000_000;
const timeoutSeconds = 10;

export function processingError(error: unknown): StorageError {
  const message = error instanceof Error ? error.message : "";
  if (/pixel limit/i.test(message)) {
    return new StorageError(
      "image_too_large",
      "This image has too many pixels. Use one under 25 megapixels.",
    );
  }
  if (/^timeout/i.test(message)) {
    return new StorageError(
      "image_too_large",
      "This image took too long to process. Choose a smaller image.",
    );
  }
  return new StorageError(
    "image_unreadable",
    "This image could not be read. Save it again as PNG, JPEG, or WebP and try again.",
  );
}

function encodeOriginal(image: Sharp, format: ResizableFormat): Sharp {
  if (format === "png") {
    return image.png();
  }
  if (format === "jpg") {
    return image.jpeg({ quality: 90 });
  }
  return image.webp({ quality: 90 });
}

export function createSharpProcessor(): ImageProcessor {
  return async (bytes, format) => {
    const { default: sharp } = await import("sharp");
    const decoded = sharp(bytes, { limitInputPixels: maxInputPixels })
      .rotate()
      .timeout({ seconds: timeoutSeconds });
    try {
      const [original, variants] = await Promise.all([
        encodeOriginal(decoded.clone(), format).toBuffer(),
        Promise.all(
          imageVariantWidths.map(async (width) => {
            const body = await decoded
              .clone()
              .resize({ width, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
            return { width, body: new Uint8Array(body) };
          }),
        ),
      ]);
      return { original: new Uint8Array(original), variants };
    } catch (error: unknown) {
      throw processingError(error);
    }
  };
}
