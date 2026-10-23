import { StorageError } from "./errors";
import type { AvatarExtension } from "./keys";

export const avatarMaxBytes = 5 * 1024 * 1024;

const imageTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const satisfies Record<string, AvatarExtension>;

export type ImageContentType = keyof typeof imageTypes;
export const imageContentTypes = Object.keys(imageTypes) as ImageContentType[];

export interface ValidatedImage {
  contentType: ImageContentType;
  extension: AvatarExtension;
  size: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return "image/gif";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  return null;
}

function isImageContentType(value: string): value is ImageContentType {
  return Object.hasOwn(imageTypes, value);
}

export interface ImageUpload {
  bytes: Uint8Array;
  declaredType: string;
}

export function validateImage(
  { bytes, declaredType }: ImageUpload,
  maxBytes: number = avatarMaxBytes,
): ValidatedImage {
  if (bytes.byteLength === 0) {
    throw new StorageError("unsupported_type", "The file is empty. Choose an image to upload.");
  }
  if (bytes.byteLength > maxBytes) {
    const limit = Math.floor(maxBytes / (1024 * 1024));
    throw new StorageError(
      "file_too_large",
      `The image is over ${limit} MB. Choose a smaller image.`,
    );
  }
  if (!isImageContentType(declaredType)) {
    throw new StorageError(
      "unsupported_type",
      "This file type is not supported. Use a PNG, JPEG, WebP, or GIF image.",
    );
  }
  const sniffed = sniffImageType(bytes);
  if (sniffed !== declaredType) {
    throw new StorageError(
      "content_mismatch",
      "The file does not look like the image type it claims to be. Choose another image.",
    );
  }
  return { contentType: sniffed, extension: imageTypes[sniffed], size: bytes.byteLength };
}

export function validateAvatar(upload: ImageUpload): ValidatedImage {
  return validateImage(upload, avatarMaxBytes);
}
