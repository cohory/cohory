export {
  attachmentExtensions,
  attachmentMaxBytes,
  attachmentNameMaxLength,
  courseAgentFileKey,
  courseAgentPrefix,
  courseAttachmentKey,
  isCourseAgentFileKey,
  isCourseAttachmentKey,
  validateAttachment,
  type AttachmentContentType,
  type AttachmentExtension,
  type AttachmentUpload,
  type ValidatedAttachment,
} from "./attachments";
export { contentTypeForKey, type StorageContentType } from "./content-types";
export { createStorage, getStorage } from "./create";
export type {
  PutObjectInput,
  StorageDriver,
  StoredObject,
  StoredObjectInfo,
  StoredObjectSummary,
} from "./driver";
export {
  defaultMaxUploadBytes,
  defaultUploadsRoute,
  parseStorageEnv,
  type LocalStorageEnv,
  type S3StorageEnv,
  type StorageEnv,
} from "./env";
export { StorageError, type StorageErrorCode } from "./errors";
export {
  avatarMaxBytes,
  imageContentTypes,
  sniffImageType,
  validateAvatar,
  validateImage,
  type ImageContentType,
  type ImageUpload,
  type ValidatedImage,
} from "./images";
export {
  avatarExtensions,
  avatarKey,
  communityKey,
  communityPrefix,
  isPublicKey,
  isStorageKey,
  parseStorageKey,
  type AvatarExtension,
  type StorageKey,
  type StoragePrefix,
} from "./keys";
export { createLocalDriver, type LocalDriverOptions } from "./local";
export { createS3Client, createS3Driver, type S3DriverOptions } from "./s3";
export { createSharpProcessor, maxInputPixels } from "./sharp-resizer";
export {
  imageSrcSetFromUrl,
  imageVariantWidths,
  isImageVariantKey,
  prepareImage,
  storedImageKeys,
  storePreparedImage,
  type ImageProcessor,
  type ImageVariantWidth,
  type PreparedImage,
  type ProcessedImage,
} from "./variants";
