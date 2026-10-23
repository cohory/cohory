export type StorageErrorCode =
  | "invalid_key"
  | "file_too_large"
  | "unsupported_type"
  | "content_mismatch"
  | "invalid_config"
  | "image_too_large"
  | "image_unreadable";

export class StorageError extends Error {
  override readonly name = "StorageError";

  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
  }
}
