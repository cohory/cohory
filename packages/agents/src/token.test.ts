import { describe, expect, it } from "vitest";

import { generateToken, hashesMatch, hashToken, isTokenFormat, tokenPrefix } from "./token";

describe("API tokens", () => {
  it("starts with cohory_ and carries 32 random bytes in base64url", () => {
    const { token } = generateToken();

    expect(token.startsWith(tokenPrefix)).toBe(true);
    expect(Buffer.from(token.slice(tokenPrefix.length), "base64url")).toHaveLength(32);
    expect(isTokenFormat(token)).toBe(true);
  });

  it("stores only a SHA-256 hex hash and a short display prefix", () => {
    const generated = generateToken();

    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.hash).toBe(hashToken(generated.token));
    expect(generated.prefix).toBe(generated.token.slice(0, 12));
    expect(generated.hash).not.toContain(generated.token.slice(7));
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken().token));

    expect(tokens.size).toBe(50);
  });

  it("refuses strings that are not cohory tokens", () => {
    expect(isTokenFormat("cohory_short")).toBe(false);
    expect(isTokenFormat(`ghp_${"a".repeat(43)}`)).toBe(false);
    expect(isTokenFormat(`cohory_${"a".repeat(42)}!`)).toBe(false);
  });

  it("compares hashes in constant time and refuses different lengths", () => {
    const hash = hashToken("cohory_x");

    expect(hashesMatch(hash, hash)).toBe(true);
    expect(hashesMatch(hash, hashToken("cohory_y"))).toBe(false);
    expect(hashesMatch(hash, hash.slice(0, 10))).toBe(false);
    expect(hashesMatch("", "")).toBe(false);
  });
});
