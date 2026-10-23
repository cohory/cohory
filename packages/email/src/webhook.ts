import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { recordSuppressionChange } from "./audit";
import { hashEmailAddress, type EmailLog } from "./log";
import type { SuppressionEntry, SuppressionList } from "./suppression";

export const emailWebhookSignatureHeader = "cohory-signature";
const toleranceSeconds = 5 * 60;
export const emailWebhookMaxBytes = 64 * 1024;

const eventSchema = z
  .object({
    type: z.enum(["hard_bounce", "complaint"]),
    email: z.email().max(320).optional(),
    addressHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    communityId: z.uuid().optional(),
  })
  .refine((event) => (event.email === undefined) !== (event.addressHash === undefined), {
    message: "Send either email or addressHash",
  });

const payloadSchema = z.object({ events: z.array(eventSchema).min(1).max(100) });

export type EmailWebhookResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "unsigned" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "recorded"; readonly count: number; readonly batchId: string };

export function signEmailWebhook(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function signatureMatches(
  secret: string,
  body: string,
  header: string | null,
  nowSeconds: number,
): boolean {
  if (!header) {
    return false;
  }
  const parts = new Map(
    header.split(",").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const given = parts.get("v1");
  if (!Number.isInteger(timestamp) || !given) {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = Buffer.from(signEmailWebhook(secret, body, timestamp).split("v1=")[1] ?? "");
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface EmailWebhookInput {
  readonly secret: string | undefined;
  readonly body: string;
  readonly signature: string | null;
  readonly list: SuppressionList;
  readonly log: EmailLog;
  readonly now?: Date;
  readonly newBatchId?: () => string;
}

export async function handleEmailWebhook(input: EmailWebhookInput): Promise<EmailWebhookResult> {
  if (!input.secret) {
    return { kind: "disabled" };
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!signatureMatches(input.secret, input.body, input.signature, nowSeconds)) {
    return { kind: "unsigned" };
  }
  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return { kind: "invalid", message: "The body is not JSON." };
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid payload." };
  }
  const entries: SuppressionEntry[] = parsed.data.events.map((event) => ({
    addressHash: event.addressHash ?? hashEmailAddress(event.email ?? ""),
    communityId: event.communityId ?? null,
    reason: event.type,
    source: "webhook",
  }));
  const batchId = (input.newBatchId ?? randomUUID)();
  for (const entry of entries) {
    await input.list.suppress(entry);
    await recordSuppressionChange(input.log, {
      change: "webhook",
      addressHash: entry.addressHash,
      batchId,
      count: entries.length,
    });
  }
  return { kind: "recorded", count: entries.length, batchId };
}

const secretSchema = z.object({
  EMAIL_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
});

export function emailWebhookSecretFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return secretSchema.parse(env).EMAIL_WEBHOOK_SECRET;
}
