import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { avatarKey, communityPrefix, type StorageKey } from "./keys";
import { createS3Driver } from "./s3";
import { pngBytes, userId } from "./test/images";

function setup(publicUrl?: string) {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const send = vi.spyOn(client, "send");
  const driver = createS3Driver({
    bucket: "cohory-test",
    region: "us-east-1",
    client,
    maxBytes: 64,
    publicUrl,
  });
  return { driver, send };
}

describe("s3 storage driver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts an object with its content type and length", async () => {
    const { driver, send } = setup();
    send.mockResolvedValue({} as never);
    const key = avatarKey(userId, "png");

    await driver.put({ key, body: pngBytes, contentType: "image/png" });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: "cohory-test",
      Key: key,
      ContentType: "image/png",
      ContentLength: pngBytes.byteLength,
    });
  });

  it("streams an object back", async () => {
    const { driver, send } = setup();
    send.mockResolvedValue({
      Body: { transformToWebStream: () => new Response(pngBytes).body },
      ContentLength: pngBytes.byteLength,
    } as never);

    const stored = await driver.get(avatarKey(userId, "png"));

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(stored?.contentType).toBe("image/png");
    expect(stored && new Uint8Array(await new Response(stored.body).arrayBuffer())).toEqual(
      pngBytes,
    );
  });

  it("returns null when the object does not exist", async () => {
    const { driver, send } = setup();
    send.mockRejectedValue(new NoSuchKey({ message: "missing", $metadata: {} }) as never);
    expect(await driver.get(avatarKey(userId, "png"))).toBeNull();
  });

  it("deletes an object", async () => {
    const { driver, send } = setup();
    send.mockResolvedValue({} as never);
    await driver.delete(avatarKey(userId, "webp"));
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("rejects oversized and mismatched uploads before calling s3", async () => {
    const { driver, send } = setup();
    await expect(
      driver.put({
        key: avatarKey(userId, "png"),
        body: new Uint8Array(65),
        contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
    await expect(
      driver.put({ key: avatarKey(userId, "png"), body: pngBytes, contentType: "image/gif" }),
    ).rejects.toMatchObject({ code: "content_mismatch" });
    await expect(driver.get("../escape.png" as StorageKey)).rejects.toMatchObject({
      code: "invalid_key",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("uses S3_PUBLIC_URL when set and the uploads route otherwise", () => {
    const key = avatarKey(userId, "png");
    expect(setup("https://cdn.example.com/bucket/").driver.publicUrl(key)).toBe(
      `https://cdn.example.com/bucket/${key}`,
    );
    expect(setup().driver.publicUrl(key)).toBe(`/api/uploads/${key}`);
  });

  it("sums object sizes across every page of a prefix listing", async () => {
    const { driver, send } = setup();
    send
      .mockResolvedValueOnce({
        Contents: [{ Size: 100 }, { Size: 23 }],
        IsTruncated: true,
        NextContinuationToken: "next",
      } as never)
      .mockResolvedValueOnce({ Contents: [{ Size: 7 }], IsTruncated: false } as never);
    const prefix = communityPrefix("019a0000-0000-7000-8000-000000000002");
    expect(await driver.usedBytes(prefix)).toBe(130);
    const first = send.mock.calls[0]?.[0];
    const second = send.mock.calls[1]?.[0];
    expect(first).toBeInstanceOf(ListObjectsV2Command);
    expect(first?.input).toEqual({ Bucket: "cohory-test", Prefix: prefix });
    expect(second?.input).toEqual({
      Bucket: "cohory-test",
      Prefix: prefix,
      ContinuationToken: "next",
    });
  });

  it("lists the keys, sizes, and modification times under a prefix across pages", async () => {
    const { driver, send } = setup();
    const at = new Date("2026-10-01T10:00:00.000Z");
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "communities/x/a.png", Size: 3, LastModified: at }],
        IsTruncated: true,
        NextContinuationToken: "next",
      } as never)
      .mockResolvedValueOnce({
        Contents: [{ Key: "communities/x/b.png", Size: 4, LastModified: at }, { Size: 1 }],
        IsTruncated: false,
      } as never);
    const prefix = communityPrefix("019a0000-0000-7000-8000-000000000002");
    expect(await driver.list(prefix)).toEqual([
      { key: "communities/x/a.png", size: 3, lastModified: at },
      { key: "communities/x/b.png", size: 4, lastModified: at },
    ]);
  });
});
