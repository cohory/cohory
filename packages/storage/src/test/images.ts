export const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

export const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

export const gifBytes = new TextEncoder().encode("GIF89a\u0001\u0000");

export const webpBytes = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");

export const userId = "019a0000-0000-7000-8000-000000000001";
export const communityId = "019a0000-0000-7000-8000-000000000002";
