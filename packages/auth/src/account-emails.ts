import type { EmailOutbox, QueuedEmail } from "@cohory/email";
import { z } from "zod";
import { logger } from "@cohory/infra/logger";

export async function deliver(outbox: EmailOutbox, email: QueuedEmail): Promise<void> {
  try {
    await outbox.send(email);
  } catch (error) {
    // Failing the request would reveal which emails have accounts, and the payload holds a token.
    logger.error(
      {
        reason: error instanceof Error ? error.name : "unknown",
      },
      `Could not send the ${email.template} email`,
    );
  }
}

const tokenClaimsSchema = z.object({
  email: z.string(),
  updateTo: z.string().optional(),
  requestType: z.string().optional(),
});

export type VerificationRequest =
  | { readonly kind: "confirm" }
  | { readonly kind: "change"; readonly from: string; readonly to: string };

// Better Auth signs one JWT shape for every verification email; a change of address carries
// `updateTo`, and the claims are ours, so reading them without the secret is safe here. Callers
// act on them only after Better Auth verified the same token.
export function verificationRequest(token: unknown): VerificationRequest {
  const claims = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!claims) {
    return { kind: "confirm" };
  }
  try {
    const parsed = tokenClaimsSchema.safeParse(
      JSON.parse(Buffer.from(claims, "base64url").toString("utf8")),
    );
    return parsed.success && parsed.data.updateTo
      ? { kind: "change", from: parsed.data.email, to: parsed.data.updateTo }
      : { kind: "confirm" };
  } catch {
    return { kind: "confirm" };
  }
}

const emailAddress = /[^\s@<>"'`]+@[^\s@<>"'`]+/g;

export function redactEmails(message: string): string {
  return message.replace(emailAddress, "[email]");
}

type LogLevel = "debug" | "info" | "success" | "warn" | "error";

// Better Auth writes addresses into some messages, such as a sign up for an existing account.
export const authLogger = {
  level: "warn",
  log(level: LogLevel, message: string, ...args: unknown[]): void {
    const details = args.map((arg) => (typeof arg === "string" ? redactEmails(arg) : arg));
    const fields = { source: "better-auth", ...(details.length > 0 ? { details } : {}) };
    const write = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
    write(fields, redactEmails(message));
  },
} as const;
