import { crc32, deflateSync } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { StorageError } from "./errors";
import { createSharpProcessor, maxInputPixels, processingError } from "./sharp-resizer";

async function png(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 170 } },
  })
    .png()
    .toBuffer();
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pngHeaderOnly(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(16))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function jpegWithGps(): Promise<Uint8Array> {
  return sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 120, b: 60 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: "Phone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 22/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("createSharpProcessor", () => {
  it("scales an image down to each variant width as webp", async () => {
    const { variants } = await createSharpProcessor()(await png(2000, 1000), "png");

    const sizes = await Promise.all(
      variants.map(async ({ width, body }) => {
        const meta = await sharp(body).metadata();
        return [width, meta.format, meta.width, meta.height];
      }),
    );

    expect(sizes).toEqual([
      [160, "webp", 160, 80],
      [640, "webp", 640, 320],
      [1280, "webp", 1280, 640],
      [1920, "webp", 1920, 960],
    ]);
  });

  it("never enlarges a smaller image", async () => {
    const { variants } = await createSharpProcessor()(await png(300, 100), "png");

    const widths = await Promise.all(
      variants.map(async ({ body }) => (await sharp(body).metadata()).width),
    );

    expect(widths).toEqual([160, 300, 300, 300]);
  });

  it("re-encodes the original in its own format without EXIF or GPS, keeping its orientation", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const { original, variants } = await createSharpProcessor()(input, "jpg");
    const meta = await sharp(original).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([100, 200]);
    for (const { body } of variants) {
      expect((await sharp(body).metadata()).exif).toBeUndefined();
    }
  });

  it("rejects an image over the pixel limit with a typed error, before decoding it", async () => {
    expect(maxInputPixels).toBe(25_000_000);

    const error = await rejection(createSharpProcessor()(pngHeaderOnly(6000, 5000), "png"));

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "image_too_large" });
  });

  it("reports a processing timeout as an image that is too large", () => {
    const error = processingError(new Error("timeout: 42% complete"));

    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe("image_too_large");
    expect(error.message).toBe("This image took too long to process. Choose a smaller image.");
  });

  it("rejects bytes that are not a readable image with a typed error", async () => {
    const error = await rejection(createSharpProcessor()(new Uint8Array([1, 2, 3]), "png"));

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "image_unreadable" });
  });
});
