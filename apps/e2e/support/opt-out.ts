import { createHash, createHmac } from "node:crypto";

// Mirrors packages/email/src/opt-out.ts with the secret from apps/e2e/compose.e2e.yml.
const secret = "e2e-only-secret-not-for-production-use-0123456789";
const purpose = "cohory.email.community-opt-out.v1";

export function addressHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function optOutToken(email: string, communityId: string): string {
  const key = createHmac("sha256", secret).update(purpose).digest();
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      h: addressHash(email),
      c: communityId,
      i: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}
