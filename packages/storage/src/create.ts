import type { StorageDriver } from "./driver";
import { parseStorageEnv, type StorageEnv } from "./env";
import { createLocalDriver } from "./local";
import { createS3Driver } from "./s3";

export function createStorage(env: StorageEnv): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    return createS3Driver({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      publicUrl: env.S3_PUBLIC_URL,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
      maxBytes: env.STORAGE_MAX_UPLOAD_BYTES,
    });
  }
  return createLocalDriver({
    root: env.STORAGE_LOCAL_PATH,
    maxBytes: env.STORAGE_MAX_UPLOAD_BYTES,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
  });
}

let defaultStorage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  defaultStorage ??= createStorage(parseStorageEnv());
  return defaultStorage;
}
