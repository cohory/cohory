import { describe, expect, it } from "vitest";

import {
  createKeyring,
  decryptSecret,
  encryptSecret,
  keyIdOf,
  needsReencryption,
  reencryptSecret,
  SecretDecryptionError,
} from "./crypto";

const key = Buffer.alloc(32, 1);
const otherKey = Buffer.alloc(32, 2);

function legacyV1(plaintext: string, secret: Buffer, context: string): string {
  const sealed = encryptSecret(plaintext, secret, context);
  const [, , iv, tag, body] = sealed.split(".");
  return ["v1", iv, tag, body].join(".");
}

describe("secret encryption", () => {
  it("round trips a secret bound to its connection id", () => {
    const sealed = encryptSecret("sk_test_abc", key, "conn-1");
    expect(sealed.startsWith(`v2.${keyIdOf(key)}.`)).toBe(true);
    expect(sealed).not.toContain("sk_test_abc");
    expect(decryptSecret(sealed, key, "conn-1")).toBe("sk_test_abc");
  });

  it("uses a fresh nonce each time", () => {
    expect(encryptSecret("same", key, "c")).not.toBe(encryptSecret("same", key, "c"));
  });

  it("fails with the wrong key, the wrong connection, or a tampered value", () => {
    const sealed = encryptSecret("whsec_1", key, "conn-1");
    expect(() => decryptSecret(sealed, otherKey, "conn-1")).toThrow(SecretDecryptionError);
    expect(() => decryptSecret(sealed, key, "conn-2")).toThrow(SecretDecryptionError);
    const parts = sealed.split(".");
    const body = Buffer.from(parts[4] ?? "", "base64url");
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], parts[2], parts[3], body.toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key, "conn-1")).toThrow(SecretDecryptionError);
    expect(() => decryptSecret("garbage", key, "conn-1")).toThrow(SecretDecryptionError);
  });

  it("derives a short key id that does not contain the key", () => {
    expect(keyIdOf(key)).toMatch(/^[0-9a-f]{12}$/);
    expect(keyIdOf(key)).not.toBe(keyIdOf(otherKey));
  });
});

describe("key rotation", () => {
  const rotated = createKeyring([otherKey, key]);

  it("encrypts with the first key of the ring", () => {
    const sealed = encryptSecret("sk_test_new", rotated, "conn-1");
    expect(sealed.split(".")[1]).toBe(keyIdOf(otherKey));
    expect(decryptSecret(sealed, otherKey, "conn-1")).toBe("sk_test_new");
  });

  it("still opens values sealed with an older key in the ring", () => {
    const sealed = encryptSecret("sk_test_old", key, "conn-1");
    expect(decryptSecret(sealed, rotated, "conn-1")).toBe("sk_test_old");
  });

  it("opens version 1 values, which carry no key id, with any key in the ring", () => {
    const sealed = legacyV1("sk_test_v1", key, "conn-1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(decryptSecret(sealed, rotated, "conn-1")).toBe("sk_test_v1");
  });

  it("refuses a value sealed with a key that left the ring", () => {
    const sealed = encryptSecret("sk_test_gone", Buffer.alloc(32, 3), "conn-1");
    expect(() => decryptSecret(sealed, rotated, "conn-1")).toThrow(SecretDecryptionError);
  });

  it("marks values that are not under the current key for re-encryption", () => {
    expect(needsReencryption(encryptSecret("a", key, "c"), rotated)).toBe(true);
    expect(needsReencryption(legacyV1("a", otherKey, "c"), rotated)).toBe(true);
    expect(needsReencryption(encryptSecret("a", otherKey, "c"), rotated)).toBe(false);
  });

  it("re-encrypts an old value under the current key without changing the secret", () => {
    const fresh = reencryptSecret(encryptSecret("whsec_x", key, "conn-9"), rotated, "conn-9");
    expect(needsReencryption(fresh, rotated)).toBe(false);
    expect(decryptSecret(fresh, otherKey, "conn-9")).toBe("whsec_x");
  });

  it("rejects an empty ring and keys that are not 32 bytes", () => {
    expect(() => createKeyring([])).toThrow();
    expect(() => createKeyring([Buffer.alloc(16)])).toThrow();
  });
});
