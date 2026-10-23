import { createDb, createPool, newId, parseDatabaseEnv } from "@cohory/db";
import { createLogMailer, type EmailMessage } from "@cohory/email";
import type { createRateLimiter } from "@cohory/rate-limit";
import { expect } from "vitest";

import { createAuth } from "../auth";
import { createAuthOptions } from "../options";

export const baseURL = "http://localhost:3000";
export const pool = createPool(parseDatabaseEnv().DATABASE_URL);
export const db = createDb(pool);
export const mailer = createLogMailer({ log: () => undefined });
export const revokedCredentials: string[] = [];
export const authEnv = {
  BETTER_AUTH_SECRET: "verification-secret-that-is-at-least-32-chars",
  BETTER_AUTH_URL: baseURL,
};

export function buildAuth(limiter?: ReturnType<typeof createRateLimiter>) {
  return createAuth(
    createAuthOptions(
      db,
      authEnv,
      mailer,
      { disabled: false, ...(limiter ? { limiter } : {}) },
      {
        emailConfigured: true,
        credentials: {
          revokeAllCredentials: async (userId) => {
            revokedCredentials.push(userId);
          },
        },
      },
    ),
  );
}

export const auth = buildAuth();

export type Auth = ReturnType<typeof buildAuth>;

export function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
  instance: Auth = auth,
): Promise<Response> {
  return instance.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

export function open(link: URL, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(link, { headers: { origin: baseURL, ...(cookie ? { cookie } : {}) } }),
  );
}

export function address(prefix: string): string {
  return `${prefix}-${newId()}@example.com`;
}

export function mailTo(email: string, subject?: string): EmailMessage[] {
  return mailer.sent.filter(
    (message) => message.to === email && (subject === undefined || message.subject === subject),
  );
}

export function linkIn(message: EmailMessage | undefined): URL {
  const match = message?.text.match(/https?:\/\/\S+/);
  if (!match) {
    throw new Error("No link found in the email");
  }
  return new URL(match[0]);
}

export function sessionCookie(response: Response): string {
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return cookie.includes("session_token=") && !cookie.endsWith("=") ? cookie : "";
}

export function location(response: Response): URL {
  return new URL(response.headers.get("location") ?? "", baseURL);
}

export async function signedIn(cookie: string): Promise<boolean> {
  return (await auth.api.getSession({ headers: new Headers({ cookie }) })) !== null;
}

export async function signUp(email: string, password: string, callbackURL = "/"): Promise<void> {
  const response = await post("/sign-up/email", { email, password, name: "Member", callbackURL });
  expect(response.status).toBe(200);
}

export async function verifiedMember(email: string, password: string): Promise<string> {
  await signUp(email, password);
  const verified = await open(linkIn(mailTo(email, "Confirm your email address")[0]));
  expect(verified.status).toBe(302);
  const response = await post("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}
