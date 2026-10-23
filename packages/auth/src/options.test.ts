import { createDb, createPool } from "@cohory/db";
import { createLogMailer, type Mailer } from "@cohory/email";
import { clientIp } from "@cohory/rate-limit";
import { getIP } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { passwordMaxLength, passwordMinLength } from "./forms";
import { createAuthOptions } from "./options";

const env = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
};

const user = {
  id: "0199e7a0-0000-7000-8000-000000000001",
  email: "member@example.test",
  name: "Ada",
  emailVerified: false,
  createdAt: new Date("2026-10-18T00:00:00Z"),
  updatedAt: new Date("2026-10-18T00:00:00Z"),
};

function buildOptions(mailer: Mailer = createLogMailer({ log: () => undefined })) {
  const pool = createPool("postgres://cohory:cohory@localhost:5433/cohory");
  return createAuthOptions(createDb(pool), env, mailer);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuthOptions", () => {
  it("leaves sign up, sign in, and password reset limits to the app limiter", () => {
    const { rateLimit } = buildOptions();

    expect(rateLimit.customRules).toEqual({
      "/sign-up/email": false,
      "/sign-in/email": false,
      "/request-password-reset": false,
      "/reset-password": false,
    });
  });

  it("turns the built in limiter off when rate limits are disabled", () => {
    const pool = createPool("postgres://cohory:cohory@localhost:5433/cohory");
    const options = createAuthOptions(
      createDb(pool),
      env,
      createLogMailer({ log: () => undefined }),
      {
        disabled: true,
      },
    );

    expect(options.rateLimit.enabled).toBe(false);
  });

  it("does not require a confirmed email when email sending is not configured", () => {
    const { emailAndPassword, user } = buildOptions();

    expect(emailAndPassword.enabled).toBe(true);
    expect(emailAndPassword.requireEmailVerification).toBe(false);
    expect(user.changeEmail.enabled).toBe(false);
  });

  it("requires a confirmed email and allows changing it when email sending is configured", () => {
    const pool = createPool("postgres://cohory:cohory@localhost:5433/cohory");
    const options = createAuthOptions(
      createDb(pool),
      env,
      createLogMailer({ log: () => undefined }),
      { disabled: false },
      { emailConfigured: true },
    );

    expect(options.emailAndPassword.requireEmailVerification).toBe(true);
    expect(options.user.changeEmail.enabled).toBe(true);
  });

  it("never signs in the person who clicks a confirmation link", () => {
    expect(buildOptions().emailVerification.autoSignInAfterVerification).toBe(false);
  });

  it("states the one hour link lifetime the email promises", () => {
    expect(buildOptions().emailVerification.expiresIn).toBe(60 * 60);
  });

  it("sends a verification email on sign up", () => {
    expect(buildOptions().emailVerification.sendOnSignUp).toBe(true);
  });

  it("revokes other sessions when a password is reset", () => {
    expect(buildOptions().emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
  });

  it("sends the password reset template to the user", async () => {
    const mailer = createLogMailer({ log: () => undefined });
    const url = "http://localhost:3000/api/auth/reset-password/tok?callbackURL=%2Freset-password";

    await buildOptions(mailer).emailAndPassword.sendResetPassword({ user, url, token: "tok" });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: user.email,
      subject: "Reset your Cohory password",
    });
    expect(mailer.sent[0]?.text).toContain(url);
    expect(mailer.sent[0]?.text).toContain("1 hour");
  });

  it("sends the verification template to the user", async () => {
    const mailer = createLogMailer({ log: () => undefined });
    const url = "http://localhost:3000/api/auth/verify-email?token=tok&callbackURL=%2F";

    await buildOptions(mailer).emailVerification.sendVerificationEmail({ user, url, token: "tok" });

    expect(mailer.sent[0]).toMatchObject({ to: user.email, subject: "Confirm your email address" });
    expect(mailer.sent[0]?.text).toContain(url);
    expect(mailer.sent[0]?.text).toContain("The link works for 1 hour.");
  });

  it("does not fail the request or log the link when the mail server is down", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: Mailer = {
      send: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1025")),
    };
    const url = "http://localhost:3000/api/auth/reset-password/secret-token?callbackURL=%2F";

    await expect(
      buildOptions(failing).emailAndPassword.sendResetPassword({
        user,
        url,
        token: "secret-token",
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-token");
  });

  it("configures no social providers and only the magic link plugin", () => {
    const options = buildOptions();

    expect((options as Record<string, unknown>)["socialProviders"]).toBeUndefined();
    expect(options.plugins.map((plugin) => plugin.id)).toEqual(["magic-link"]);
  });

  it("mounts under /api/auth with the configured secret and base URL", () => {
    const options = buildOptions();

    expect(options.basePath).toBe("/api/auth");
    expect(options.baseURL).toBe(env.BETTER_AUTH_URL);
    expect(options.secret).toBe(env.BETTER_AUTH_SECRET);
  });

  it("uses the Drizzle adapter", () => {
    expect(buildOptions().database).toBeTypeOf("function");
  });

  // The schema's default makes UUIDv7 ids (see the integration test); "uuid" also makes Better
  // Auth shape the ids it derives itself, such as single use reservations, as uuids.
  it("leaves auth record ids to the uuid columns", () => {
    expect(buildOptions().advanced.database.generateId).toBe("uuid");
  });

  it("enforces the same password length rules as the forms", () => {
    const { emailAndPassword } = buildOptions();

    expect(emailAndPassword.minPasswordLength).toBe(passwordMinLength);
    expect(emailAndPassword.maxPasswordLength).toBe(passwordMaxLength);
  });

  it("passes versioned secrets to Better Auth when they are set", () => {
    const pool = createPool("postgres://cohory:cohory@localhost:5433/cohory");
    const secrets = [
      { version: 2, value: "new-secret-that-is-at-least-32-characters" },
      { version: 1, value: env.BETTER_AUTH_SECRET },
    ];

    const options = createAuthOptions(
      createDb(pool),
      { ...env, BETTER_AUTH_SECRETS: secrets },
      createLogMailer({ log: () => undefined }),
    );

    expect(options.secrets).toEqual(secrets);
    expect(buildOptions().secrets).toBeUndefined();
  });

  // Account service revokes sessions by deleting rows, which only works while every session read
  // goes to the database.
  it("keeps sessions in the database only, without a cookie cache or secondary storage", () => {
    const options: Record<string, unknown> = buildOptions();

    expect(options["secondaryStorage"]).toBeUndefined();
    expect(options).not.toHaveProperty("session.cookieCache.enabled", true);
  });

  it.each([
    ["one forwarded address", { "x-forwarded-for": "203.0.113.9" }],
    ["a forwarded chain", { "x-forwarded-for": "198.51.100.1, 203.0.113.9" }],
    ["a chain with spaces", { "x-forwarded-for": " 198.51.100.1 ,203.0.113.77 " }],
    ["only X-Real-IP", { "x-real-ip": "203.0.113.20" }],
  ])("resolves the same client address as the app limiter for %s", (_case, headers) => {
    const options = buildOptions();
    const request = new Request("http://localhost:3000/api/auth/sign-in/email", { headers });

    expect(getIP(request, options)).toBe(clientIp(new Headers(headers)));
  });

  it("groups IPv6 clients by /64 like the app limiter", () => {
    const options = buildOptions();
    const headers = { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" };
    const request = new Request("http://localhost:3000/", { headers });

    expect(getIP(request, options)).toBe("2001:0db8:0001:0002:0000:0000:0000:0000");
    expect(options.advanced.ipAddress.ipv6Subnet).toBe(64);
  });
});
