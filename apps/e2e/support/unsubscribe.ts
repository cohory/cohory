import { createHmac } from "node:crypto";

// Mirrors packages/notifications/src/unsubscribe.ts with the secret from apps/e2e/compose.e2e.yml.
const secret = "e2e-only-secret-not-for-production-use-0123456789";
const purpose = "cohory.notifications.unsubscribe.v1";

export function unsubscribeToken(userId: string, scope: string): string {
  const key = createHmac("sha256", secret).update(purpose).digest();
  const body = Buffer.from(JSON.stringify({ v: 1, u: userId, s: scope })).toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}
