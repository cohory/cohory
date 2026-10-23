import { describe, expect, it } from "vitest";

import { avatarMaxBytes, sniffImageType, validateAvatar } from "./images";
import { gifBytes, jpegBytes, pngBytes, webpBytes } from "./test/images";

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      return error.code;
    }
  }
  return undefined;
}

describe("image validation", () => {
  it.each([
    [pngBytes, "image/png"],
    [jpegBytes, "image/jpeg"],
    [gifBytes, "image/gif"],
    [webpBytes, "image/webp"],
  ] as const)("detects %#: %s from its bytes", (bytes, type) => {
    expect(sniffImageType(bytes)).toBe(type);
  });

  it("accepts a png avatar and maps it to the png extension", () => {
    expect(validateAvatar({ bytes: pngBytes, declaredType: "image/png" })).toEqual({
      contentType: "image/png",
      extension: "png",
      size: pngBytes.byteLength,
    });
  });

  it("maps jpeg to the jpg extension", () => {
    expect(validateAvatar({ bytes: jpegBytes, declaredType: "image/jpeg" }).extension).toBe("jpg");
  });

  it("rejects an avatar over 5 MB", () => {
    const bytes = new Uint8Array(avatarMaxBytes + 1);
    bytes.set(pngBytes);
    expect(codeOf(() => validateAvatar({ bytes, declaredType: "image/png" }))).toBe(
      "file_too_large",
    );
  });

  it("rejects a type outside the allowlist", () => {
    expect(codeOf(() => validateAvatar({ bytes: pngBytes, declaredType: "image/svg+xml" }))).toBe(
      "unsupported_type",
    );
  });

  it("rejects bytes that do not match the declared type", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(codeOf(() => validateAvatar({ bytes: html, declaredType: "image/png" }))).toBe(
      "content_mismatch",
    );
    expect(codeOf(() => validateAvatar({ bytes: jpegBytes, declaredType: "image/png" }))).toBe(
      "content_mismatch",
    );
  });

  it("rejects an empty file", () => {
    expect(
      codeOf(() => validateAvatar({ bytes: new Uint8Array(), declaredType: "image/png" })),
    ).toBe("unsupported_type");
  });
});
