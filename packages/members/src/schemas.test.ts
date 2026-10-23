import { describe, expect, it } from "vitest";

import { updateProfileInputSchema } from "./schemas";

const zeroWidthSpace = String.fromCodePoint(0x200b);
const byteOrderMark = String.fromCodePoint(0xfeff);
const leftToRightIsolate = String.fromCodePoint(0x2066);

describe("updateProfileInputSchema", () => {
  it("strips invisible characters from the bio and treats a bio of only those as empty", () => {
    expect(
      updateProfileInputSchema.parse({
        bio: `Potter${zeroWidthSpace} in Lyon${leftToRightIsolate}`,
      }).bio,
    ).toBe("Potter in Lyon");
    expect(
      updateProfileInputSchema.parse({ bio: `${zeroWidthSpace}${byteOrderMark}` }).bio,
    ).toBeNull();
  });
});
