import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

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
import { isStorageKey, parseStorageKey, type StorageKey, type StoragePrefix } from "./keys";

export interface S3DriverOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  publicUrl?: string;
  publicBaseUrl?: string;
  maxBytes?: number;
  client?: S3Client;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
  );
}

export function createS3Client(options: S3DriverOptions): S3Client {
  return new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? false,
    credentials:
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined,
  });
}

export function createS3Driver(options: S3DriverOptions): StorageDriver {
  const client = options.client ?? createS3Client(options);
  const maxBytes = options.maxBytes ?? defaultMaxUploadBytes;
  const bucket = options.bucket;

  return {
    kind: "s3",
    maxBytes,

    async put(input: PutObjectInput): Promise<StoredObjectInfo> {
      const contentType = assertPutAllowed(input, maxBytes);
      const key = parseStorageKey(input.key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: input.body,
          ContentType: contentType,
          ContentLength: input.body.byteLength,
        }),
      );
      return { key, contentType, size: input.body.byteLength };
    },

    async get(key: StorageKey): Promise<StoredObject | null> {
      const parsed = parseStorageKey(key);
      const contentType = contentTypeForKey(parsed);
      if (contentType === null) {
        return null;
      }
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: parsed }));
        if (!result.Body) {
          return null;
        }
        return {
          key: parsed,
          contentType,
          size: result.ContentLength ?? 0,
          body: result.Body.transformToWebStream(),
        };
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async delete(key: StorageKey): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: parseStorageKey(key) }));
    },

    publicUrl(key: StorageKey): string {
      const parsed = parseStorageKey(key);
      return joinUrl(options.publicUrl ?? options.publicBaseUrl ?? defaultUploadsRoute, parsed);
    },

    async list(prefix: StoragePrefix): Promise<StoredObjectSummary[]> {
      const objects: StoredObjectSummary[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key && isStorageKey(object.Key)) {
            objects.push({
              key: object.Key,
              size: object.Size ?? 0,
              lastModified: object.LastModified ?? new Date(0),
            });
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },

    async usedBytes(prefix: StoragePrefix): Promise<number> {
      let total = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents ?? []) {
          total += object.Size ?? 0;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return total;
    },
  };
}
