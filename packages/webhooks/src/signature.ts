import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secretPrefix = "whsec_";
const toleranceSeconds = 5 * 60;

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`webhook verification failed: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

export interface SignedMessage {
  readonly secret: string;
  readonly id: string;
  readonly timestamp: number;
  readonly body: string;
}

function secretKey(secret: string): Buffer {
  return Buffer.from(
    secret.startsWith(secretPrefix) ? secret.slice(secretPrefix.length) : secret,
    "base64",
  );
}

export function generateWebhookSecret(): string {
  return `${secretPrefix}${randomBytes(24).toString("base64")}`;
}

export function signWebhook({ secret, id, timestamp, body }: SignedMessage): string {
  const digest = createHmac("sha256", secretKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

export function webhookHeaders(
  message: SignedMessage,
  previousSecrets: readonly string[] = [],
): Record<string, string> {
  return {
    "webhook-id": message.id,
    "webhook-timestamp": String(message.timestamp),
    "webhook-signature": [message.secret, ...previousSecrets]
      .map((secret) => signWebhook({ ...message, secret }))
      .join(" "),
  };
}

export interface VerifyInput {
  readonly secret: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
}

export function verifyWebhook({ secret, body, headers, now = new Date() }: VerifyInput): void {
  const id = headers["webhook-id"];
  const timestampHeader = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestampHeader || !signatures) {
    throw new WebhookVerificationError("missing headers");
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) {
    throw new WebhookVerificationError("invalid timestamp");
  }
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) {
    throw new WebhookVerificationError("timestamp outside tolerance");
  }
  const expected = Buffer.from(signWebhook({ secret, id, timestamp, body }));
  const matched = signatures.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) {
    throw new WebhookVerificationError("no matching signature");
  }
}
