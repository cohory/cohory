import { describe, expect, it } from "vitest";

import { createStorage } from "./create";
import { parseStorageEnv } from "./env";

describe("storage env", () => {
  it("defaults to the local driver under ./data/uploads", () => {
    const env = parseStorageEnv({});
    expect(env).toMatchObject({
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_PATH: "./data/uploads",
      STORAGE_MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
    });
    expect(createStorage(env).kind).toBe("local");
  });

  it("parses the s3 driver settings", () => {
    const env = parseStorageEnv({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "uploads",
      S3_ENDPOINT: "http://minio:9000",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_FORCE_PATH_STYLE: "true",
      S3_REGION: "",
    });
    expect(env).toMatchObject({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "uploads",
      S3_REGION: "us-east-1",
      S3_FORCE_PATH_STYLE: true,
    });
    expect(createStorage(env).kind).toBe("s3");
  });

  it("requires a bucket for s3", () => {
    expect(() => parseStorageEnv({ STORAGE_DRIVER: "s3" })).toThrow();
  });

  it("rejects half configured credentials", () => {
    expect(() =>
      parseStorageEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "uploads", S3_ACCESS_KEY_ID: "key" }),
    ).toThrow();
  });

  it("rejects an unknown driver", () => {
    expect(() => parseStorageEnv({ STORAGE_DRIVER: "ftp" })).toThrow();
  });
});
