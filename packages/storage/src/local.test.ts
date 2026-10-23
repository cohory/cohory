import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StorageDriver } from "./driver";
import { StorageError } from "./errors";
import { avatarKey, communityKey, communityPrefix, type StorageKey } from "./keys";
import { createLocalDriver } from "./local";
import { communityId, pngBytes, userId } from "./test/images";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("local storage driver", () => {
  let root: string;
  let driver: StorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cohory-storage-"));
    driver = createLocalDriver({ root, maxBytes: 64 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes, reads, and deletes a file", async () => {
    const key = avatarKey(userId, "png");
    const info = await driver.put({ key, body: pngBytes, contentType: "image/png" });
    expect(info).toEqual({ key, contentType: "image/png", size: pngBytes.byteLength });
    expect(await readFile(path.join(root, key))).toEqual(Buffer.from(pngBytes));

    const stored = await driver.get(key);
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.size).toBe(pngBytes.byteLength);
    expect(stored && (await readAll(stored.body))).toEqual(pngBytes);

    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
  });

  it("overwrites an existing file", async () => {
    const key = communityKey(communityId, "notes.txt");
    await driver.put({
      key,
      body: new TextEncoder().encode("one"),
      contentType: "text/plain; charset=utf-8",
    });
    await driver.put({
      key,
      body: new TextEncoder().encode("two"),
      contentType: "text/plain; charset=utf-8",
    });
    const stored = await driver.get(key);
    expect(stored && new TextDecoder().decode(await readAll(stored.body))).toBe("two");
  });

  it("returns null for a missing file and ignores deleting one", async () => {
    const key = avatarKey(userId, "gif");
    expect(await driver.get(key)).toBeNull();
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it("rejects keys that try to leave the root", async () => {
    const outside = "../outside.png" as StorageKey;
    await expect(
      driver.put({ key: outside, body: pngBytes, contentType: "image/png" }),
    ).rejects.toBeInstanceOf(StorageError);
    await expect(driver.get(outside)).rejects.toBeInstanceOf(StorageError);
    await expect(driver.delete("users/../../x.png" as StorageKey)).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("rejects a file over the size limit", async () => {
    await expect(
      driver.put({
        key: communityKey(communityId, "big.txt"),
        body: new Uint8Array(65),
        contentType: "text/plain; charset=utf-8",
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("rejects a content type that does not match the extension or is unknown", async () => {
    await expect(
      driver.put({ key: avatarKey(userId, "png"), body: pngBytes, contentType: "text/html" }),
    ).rejects.toMatchObject({ code: "content_mismatch" });
    await expect(
      driver.put({
        key: communityKey(communityId, "page.html"),
        body: pngBytes,
        contentType: "text/html",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("builds the public url under the uploads route", () => {
    expect(driver.publicUrl(avatarKey(userId, "png"))).toBe(
      `/api/uploads/users/${userId}/avatar.png`,
    );
  });

  it("sums the bytes stored under a community prefix and nothing else", async () => {
    const other = "019a0000-0000-7000-8000-000000000003";
    await driver.put({
      key: communityKey(communityId, "posts", "a.png"),
      body: pngBytes,
      contentType: "image/png",
    });
    await driver.put({
      key: communityKey(communityId, "courses", "x", "b.png"),
      body: pngBytes.slice(0, 10),
      contentType: "image/png",
    });
    await driver.put({
      key: communityKey(other, "posts", "c.png"),
      body: pngBytes,
      contentType: "image/png",
    });
    await driver.put({ key: avatarKey(userId, "png"), body: pngBytes, contentType: "image/png" });

    expect(await driver.usedBytes(communityPrefix(communityId))).toBe(pngBytes.byteLength + 10);
    expect(await driver.usedBytes(communityPrefix("019a0000-0000-7000-8000-000000000009"))).toBe(0);
  });

  it("lists the files under a prefix with their size and modification time", async () => {
    const key = communityKey(communityId, "posts", "a.png");
    await driver.put({ key, body: pngBytes, contentType: "image/png" });
    await driver.put({ key: avatarKey(userId, "png"), body: pngBytes, contentType: "image/png" });

    const listed = await driver.list(communityPrefix(communityId));

    expect(listed.map((entry) => [entry.key, entry.size])).toEqual([[key, pngBytes.byteLength]]);
    expect(listed[0]?.lastModified).toBeInstanceOf(Date);
    expect(await driver.list(communityPrefix("019a0000-0000-7000-8000-000000000009"))).toEqual([]);
  });
});
