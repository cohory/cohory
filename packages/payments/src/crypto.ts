import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const legacyVersion = "v1";
const version = "v2";
const algorithm = "aes-256-gcm";

export class SecretDecryptionError extends Error {
  constructor() {
    super("stored secret could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

export interface Keyring {
  readonly currentId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

export type KeyInput = Buffer | Keyring;

export function keyIdOf(key: Buffer): string {
  return createHash("sha256")
    .update("cohory-secret-key-id:")
    .update(key)
    .digest("hex")
    .slice(0, 12);
}

export function createKeyring(keys: readonly Buffer[]): Keyring {
  const [current] = keys;
  if (!current) {
    throw new Error("a keyring needs at least one key");
  }
  const entries = keys.map((key): [string, Buffer] => {
    if (key.length !== 32) {
      throw new Error("encryption keys must be 32 bytes");
    }
    return [keyIdOf(key), key];
  });
  return { currentId: keyIdOf(current), keys: new Map(entries) };
}

export function parseKeyList(value: string): Buffer[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Buffer.from(entry, "base64"));
}

export function keyringFrom(lists: readonly (readonly Buffer[])[]): Keyring | null {
  const seen = new Set<string>();
  const keys: Buffer[] = [];
  for (const key of lists.flat()) {
    const id = keyIdOf(key);
    if (!seen.has(id)) {
      seen.add(id);
      keys.push(key);
    }
  }
  return keys.length > 0 ? createKeyring(keys) : null;
}

function ringOf(input: KeyInput): Keyring {
  return Buffer.isBuffer(input) ? createKeyring([input]) : input;
}

function currentKey(ring: Keyring): Buffer {
  const key = ring.keys.get(ring.currentId);
  if (!key) {
    throw new Error("the current key is missing from the keyring");
  }
  return key;
}

export function encryptSecret(plaintext: string, keys: KeyInput, context: string): string {
  const ring = ringOf(keys);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, currentKey(ring), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    version,
    ring.currentId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

interface SealedParts {
  readonly keyId: string | null;
  readonly iv: string;
  readonly tag: string;
  readonly body: string;
}

function parseSealed(sealed: string): SealedParts {
  const parts = sealed.split(".");
  if (parts[0] === version && parts.length === 5) {
    const [, keyId = "", iv = "", tag = "", body = ""] = parts;
    if (keyId && iv && tag) {
      return { keyId, iv, tag, body };
    }
  }
  if (parts[0] === legacyVersion && parts.length === 4) {
    const [, iv = "", tag = "", body = ""] = parts;
    if (iv && tag) {
      return { keyId: null, iv, tag, body };
    }
  }
  throw new SecretDecryptionError();
}

function open(parts: SealedParts, key: Buffer, context: string): string {
  const decipher = createDecipheriv(algorithm, key, Buffer.from(parts.iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(parts.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptSecret(sealed: string, keys: KeyInput, context: string): string {
  const ring = ringOf(keys);
  const parts = parseSealed(sealed);
  const candidates =
    parts.keyId === null
      ? [...ring.keys.values()]
      : [ring.keys.get(parts.keyId)].filter((key): key is Buffer => key !== undefined);
  for (const key of candidates) {
    try {
      return open(parts, key, context);
    } catch {
      continue;
    }
  }
  throw new SecretDecryptionError();
}

export function needsReencryption(sealed: string, keys: KeyInput): boolean {
  const ring = ringOf(keys);
  try {
    return parseSealed(sealed).keyId !== ring.currentId;
  } catch {
    return false;
  }
}

export function reencryptSecret(sealed: string, keys: KeyInput, context: string): string {
  return encryptSecret(decryptSecret(sealed, keys, context), keys, context);
}
