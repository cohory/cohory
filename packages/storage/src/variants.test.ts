import { describe, expect, it, vi } from "vitest";

import type { PutObjectInput, StoredObjectInfo } from "./driver";
import { StorageError } from "./errors";
import { parseStorageKey, type StorageKey } from "./keys";
import { communityId, gifBytes, pngBytes } from "./test/images";
import {
  imageSrcSetFromUrl,
  imageVariantWidths,
  isImageVariantKey,
  prepareImage,
  storedImageKeys,
  storePreparedImage,
  type ImageProcessor,
} from "./variants";

const original = parseStorageKey(
  `communities/${communityId}/gallery/019a0000-0000-7000-8000-0000000000aa.png`,
);
const sized = parseStorageKey(
  `communities/${communityId}/gallery/019a0000-0000-7000-8000-0000000000aa.sized.png`,
);

function memoryDriver() {
  const puts: PutObjectInput[] = [];
  const deleted: StorageKey[] = [];
  return {
    puts,
    deleted,
    driver: {
      put: vi.fn(async (input: PutObjectInput): Promise<StoredObjectInfo> => {
        puts.push(input);
        return { key: input.key, contentType: "image/png", size: input.body.byteLength };
      }),
      delete: vi.fn(async (key: StorageKey) => {
        deleted.push(key);
      }),
    },
  };
}

const cleaned = new Uint8Array([7, 7]);
const formats: string[] = [];
const process: ImageProcessor = async (_bytes, format) => {
  formats.push(format);
  return {
    original: cleaned,
    variants: imageVariantWidths.map((width) => ({
      width,
      body: new Uint8Array(width / 10),
    })),
  };
};

describe("image variants", () => {
  it("stores webp variants at 160, 640, 1280, and 1920 pixels next to a cleaned sized original", async () => {
    const { driver, puts } = memoryDriver();

    const prepared = await prepareImage(
      { key: original, body: pngBytes, contentType: "image/png" },
      process,
    );
    const key = await storePreparedImage(driver, prepared);

    expect(imageVariantWidths).toEqual([160, 640, 1280, 1920]);
    expect(formats.at(-1)).toBe("png");
    expect(key).toBe(sized);
    expect(puts.map((put) => [put.key.split("/").pop(), put.contentType])).toEqual([
      ["019a0000-0000-7000-8000-0000000000aa.w160.webp", "image/webp"],
      ["019a0000-0000-7000-8000-0000000000aa.w640.webp", "image/webp"],
      ["019a0000-0000-7000-8000-0000000000aa.w1280.webp", "image/webp"],
      ["019a0000-0000-7000-8000-0000000000aa.w1920.webp", "image/webp"],
      ["019a0000-0000-7000-8000-0000000000aa.sized.png", "image/png"],
    ]);
    expect(puts.at(-1)?.body).toBe(cleaned);
  });

  it("counts the bytes of the original and every variant", async () => {
    const prepared = await prepareImage(
      { key: original, body: pngBytes, contentType: "image/png" },
      process,
    );

    expect(prepared.bytes).toBe(cleaned.byteLength + 16 + 64 + 128 + 192);
  });

  it("keeps a GIF as it is, because resizing would drop its animation", async () => {
    const { driver, puts } = memoryDriver();
    const gif = parseStorageKey(`communities/${communityId}/gallery/a.gif`);

    const prepared = await prepareImage(
      { key: gif, body: gifBytes, contentType: "image/gif" },
      process,
    );
    const key = await storePreparedImage(driver, prepared);

    expect(prepared.bytes).toBe(gifBytes.byteLength);
    expect(key).toBe(gif);
    expect(puts.map((put) => put.key)).toEqual([gif]);
  });

  it("passes a processing error on and stores nothing", async () => {
    const tooLarge = new StorageError("image_too_large", "too large");

    await expect(
      prepareImage({ key: original, body: pngBytes, contentType: "image/png" }, async () => {
        throw tooLarge;
      }),
    ).rejects.toBe(tooLarge);
  });

  it("removes stored variants when the original cannot be stored", async () => {
    const { driver, deleted } = memoryDriver();
    driver.put.mockImplementation(async (input: PutObjectInput) => {
      if (input.key === sized) throw new Error("disk full");
      return { key: input.key, contentType: "image/webp" as const, size: 1 };
    });
    const prepared = await prepareImage(
      { key: original, body: pngBytes, contentType: "image/png" },
      process,
    );

    await expect(storePreparedImage(driver, prepared)).rejects.toThrow("disk full");
    expect(deleted).toHaveLength(4);
  });

  it("lists the original and its variants for deletion", () => {
    expect(storedImageKeys(original)).toEqual([original]);
    expect(storedImageKeys(sized).map((key) => key.split("/").pop())).toEqual([
      "019a0000-0000-7000-8000-0000000000aa.sized.png",
      "019a0000-0000-7000-8000-0000000000aa.w160.webp",
      "019a0000-0000-7000-8000-0000000000aa.w640.webp",
      "019a0000-0000-7000-8000-0000000000aa.w1280.webp",
      "019a0000-0000-7000-8000-0000000000aa.w1920.webp",
    ]);
  });

  it("recognizes variant keys", () => {
    expect(isImageVariantKey(`${sized.replace(".sized.png", "")}.w640.webp`)).toBe(true);
    expect(isImageVariantKey(`${sized.replace(".sized.png", "")}.w641.webp`)).toBe(false);
    expect(isImageVariantKey(sized)).toBe(false);
  });

  it("builds a srcset from the public URL of a sized original only", () => {
    expect(imageSrcSetFromUrl("https://cdn.test/communities/c/gallery/x.sized.jpg")).toBe(
      [
        "https://cdn.test/communities/c/gallery/x.w160.webp 160w",
        "https://cdn.test/communities/c/gallery/x.w640.webp 640w",
        "https://cdn.test/communities/c/gallery/x.w1280.webp 1280w",
        "https://cdn.test/communities/c/gallery/x.w1920.webp 1920w",
      ].join(", "),
    );
    expect(imageSrcSetFromUrl("/api/uploads/communities/c/gallery/x.png")).toBeNull();
  });
});
