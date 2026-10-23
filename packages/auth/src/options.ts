import type { Database } from "@cohory/db";
import { accounts, sessions, users, verifications } from "@cohory/db/schema";
import { directEmailOutbox, type EmailOutbox, type Mailer } from "@cohory/email";
import { clientIp, RateLimitedError, type RateLimiter } from "@cohory/rate-limit";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq } from "drizzle-orm";

import { authLogger, deliver, verificationRequest } from "./account-emails";
import { deviceLabel } from "./device";
import type { AuthEnv } from "./env";
import { passwordMaxLength, passwordMinLength, profileNameSchema } from "./forms";
import { safeRedirectPath, signInPath, verifiedPath } from "./redirects";
import type { SignUpGate } from "./sign-up-gate";
import { createUnprovenPasswordGuard, signOutOtherDevices } from "./unproven-password";

const resetPasswordTokenExpiresInSeconds = 60 * 60;
const verificationTokenExpiresInSeconds = 60 * 60;
const magicLinkExpiresInSeconds = 15 * 60;

const accountEmailPaths = new Set([
  "/send-verification-email",
  "/sign-in/magic-link",
  "/change-email",
]);
const verificationCallbackPaths = new Set(["/send-verification-email", "/change-email"]);

export const appLimitedAuthPaths = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
] as const;

export interface AuthRateLimitOptions {
  readonly disabled: boolean;
  readonly limiter?: Pick<RateLimiter, "check" | "consume">;
}

// The app limiter reads the last X-Forwarded-For entry, the one our proxy appended. An unroutable
// trusted proxy makes Better Auth walk the chain from the right and stop at that same entry.
const rightmostForwardedAddress = {
  ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
  trustedProxies: ["255.255.255.255/32"],
  ipv6Subnet: 64,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BearerCredentials {
  revokeAllCredentials(userId: string): Promise<unknown>;
}

export interface AuthHookOptions {
  readonly credentials?: BearerCredentials;
  readonly avatarUrlBelongsTo?: (userId: string, url: string) => boolean;
  readonly emailOutbox?: EmailOutbox;
  readonly emailConfigured?: boolean;
  readonly termsVersion?: string | null;
  readonly signUpAllowed?: SignUpGate;
  readonly appName?: string;
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

type AccountLimiter = Pick<RateLimiter, "check" | "consume">;

function accountKey(email: unknown): string | null {
  return typeof email === "string" ? `account:${email.trim().toLowerCase()}` : null;
}

function tooManyRequests(retryAfterSeconds: number): APIError {
  const retryAfter = String(Math.max(1, retryAfterSeconds));
  return new APIError(
    "TOO_MANY_REQUESTS",
    { code: "RATE_LIMITED", message: "Too many attempts. Wait a moment and try again." },
    { "Retry-After": retryAfter, "X-Retry-After": retryAfter },
  );
}

function refuseLockedAccount(limiter: AccountLimiter, email: unknown): void {
  const key = accountKey(email);
  const decision = key ? limiter.check("signInAccount", key) : null;
  if (decision && !decision.allowed) {
    throw tooManyRequests(decision.retryAfterSeconds);
  }
}

function limitAccountEmail(
  limiter: AccountLimiter,
  body: Record<string, unknown>,
  headers: Headers | undefined,
): void {
  const address = accountKey(body["email"] ?? body["newEmail"]);
  try {
    if (headers) {
      limiter.consume("signIn", `account-email-ip:${clientIp(headers)}`);
    }
    if (address) {
      limiter.consume("passwordReset", `account-email:${address}`);
    }
  } catch (error) {
    if (error instanceof RateLimitedError) {
      throw tooManyRequests(error.retryAfterSeconds);
    }
    throw error;
  }
}

function magicLinkBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = safeRedirectPath(body["callbackURL"]);
  return { email: body["email"], callbackURL: next, errorCallbackURL: signInPath(next) };
}

function countFailedSignIn(limiter: AccountLimiter, email: unknown, returned: unknown): void {
  const key = accountKey(email);
  if (!key || !(returned instanceof APIError) || returned.statusCode === 429) {
    return;
  }
  try {
    limiter.consume("signInAccount", key);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) {
      throw error;
    }
  }
}

function signUpClosed(): APIError {
  return new APIError("FORBIDDEN", {
    code: "SIGN_UP_CLOSED",
    message: "This server is not open for new accounts.",
  });
}

function invalidName(message: string | undefined): APIError {
  return new APIError("BAD_REQUEST", {
    code: "INVALID_NAME",
    message: message ?? "Enter your name.",
  });
}

function invalidImage(): APIError {
  return new APIError("BAD_REQUEST", {
    code: "INVALID_IMAGE",
    message: "Upload a profile photo from your account page.",
  });
}

function withProfileName(body: Record<string, unknown>): Record<string, unknown> {
  if (body["name"] === undefined) {
    return body;
  }
  const name = profileNameSchema.safeParse(body["name"]);
  if (!name.success) {
    throw invalidName(name.error.issues[0]?.message);
  }
  return { ...body, name: name.data };
}

function hasImage(body: Record<string, unknown>): boolean {
  return body["image"] !== undefined && body["image"] !== null;
}

function signUpBody(body: Record<string, unknown>): Record<string, unknown> {
  if (hasImage(body)) {
    throw invalidImage();
  }
  if (body["name"] === undefined) {
    throw invalidName(undefined);
  }
  return withProfileName(body);
}

async function profileUpdate(
  ctx: HookContext,
  body: Record<string, unknown>,
  avatarUrlBelongsTo: ((userId: string, url: string) => boolean) | undefined,
): Promise<Record<string, unknown>> {
  const update = withProfileName(body);
  const image = body["image"];
  if (hasImage(body)) {
    const session = await getSessionFromCtx(ctx);
    if (session && (typeof image !== "string" || !avatarUrlBelongsTo?.(session.user.id, image))) {
      throw invalidImage();
    }
  }
  return update;
}

// Better Auth skips the approval of the current mailbox for an unconfirmed account, which only a
// session from before verification was required can still have.
async function refuseUnconfirmedMover(ctx: HookContext): Promise<void> {
  const session = await getSessionFromCtx(ctx);
  if (session && !session.user.emailVerified) {
    throw new APIError("FORBIDDEN", {
      code: "EMAIL_NOT_VERIFIED",
      message: "Confirm your current email address before you change it.",
    });
  }
}

type AccountUser = { id: string; email: string; name: string };

function changedPasswordUser(context: {
  returned?: unknown;
  session?: { user: AccountUser } | null;
  newSession?: { user: AccountUser } | null;
}): AccountUser | null {
  if (context.returned instanceof APIError || context.returned instanceof Error) {
    return null;
  }
  return context.newSession?.user ?? context.session?.user ?? null;
}

export function createAuthOptions(
  db: Database,
  env: AuthEnv,
  mailer: Mailer,
  rateLimit: AuthRateLimitOptions = { disabled: false },
  hooks: AuthHookOptions = {},
) {
  const outbox = hooks.emailOutbox ?? directEmailOutbox(mailer);
  const emailConfigured = hooks.emailConfigured ?? false;
  const appUrl = (path: string) => new URL(path, env.BETTER_AUTH_URL).toString();

  const revokeBearerCredentials = async (userId: string | null): Promise<void> => {
    if (userId && hooks.credentials) {
      await hooks.credentials.revokeAllCredentials(userId);
    }
  };

  const notifyPasswordChanged = (user: AccountUser, userAgent: string | null | undefined) =>
    deliver(outbox, {
      template: "password-changed",
      to: user.email,
      data: {
        name: user.name,
        changedAt: new Date().toISOString(),
        device: deviceLabel(userAgent),
        resetUrl: appUrl("/forgot-password"),
      },
    });

  // A reset link reached the mailbox, which proves it as well as a confirmation link does.
  const confirmEmail = async (userId: string): Promise<void> => {
    await db
      .update(users)
      .set({ emailVerified: true })
      .where(and(eq(users.id, userId), eq(users.emailVerified, false)));
  };

  const unprovenPassword = createUnprovenPasswordGuard(db, {
    revokeBearerCredentials,
    notifyPasswordRemoved: async (userId) => {
      const [user] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (user) {
        await deliver(outbox, {
          template: "password-removed",
          to: user.email,
          data: { name: user.name, securityUrl: appUrl("/account/security") },
        });
      }
    },
  });

  // Moving the account to another mailbox ends every other way in, as a password change does.
  const finishEmailChange = async (ctx: HookContext): Promise<void> => {
    const request = verificationRequest(ctx.query?.["token"]);
    const active = ctx.context.newSession;
    if (request.kind !== "change" || !active || active.user.email !== request.to) {
      return;
    }
    await signOutOtherDevices(db, active.user.id, active.session.id);
    await revokeBearerCredentials(active.user.id);
  };

  return {
    appName: hooks.appName ?? "Cohory",
    logger: authLogger,
    secret: env.BETTER_AUTH_SECRET,
    ...(env.BETTER_AUTH_SECRETS ? { secrets: env.BETTER_AUTH_SECRETS } : {}),
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    rateLimit: {
      enabled: rateLimit.disabled ? false : process.env.NODE_ENV === "production",
      storage: "memory",
      customRules: Object.fromEntries(appLimitedAuthPaths.map((path) => [path, false] as const)),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!isRecord(ctx.body)) {
          return;
        }
        if (ctx.path === "/sign-in/magic-link" && !emailConfigured) {
          throw new APIError("NOT_FOUND");
        }
        if (accountEmailPaths.has(ctx.path) && rateLimit.limiter) {
          limitAccountEmail(rateLimit.limiter, ctx.body, ctx.headers);
        }
        if (ctx.path === "/sign-in/email" && rateLimit.limiter) {
          refuseLockedAccount(rateLimit.limiter, ctx.body["email"]);
          return;
        }
        if (ctx.path === "/sign-up/email") {
          if (hooks.signUpAllowed && !(await hooks.signUpAllowed(ctx.body["callbackURL"]))) {
            throw signUpClosed();
          }
          const body = signUpBody(ctx.body);
          return { context: { body: { ...body, callbackURL: verifiedPath(body["callbackURL"]) } } };
        }
        if (ctx.path === "/change-email") {
          await refuseUnconfirmedMover(ctx);
        }
        if (verificationCallbackPaths.has(ctx.path)) {
          return {
            context: { body: { ...ctx.body, callbackURL: verifiedPath(ctx.body["callbackURL"]) } },
          };
        }
        if (ctx.path === "/sign-in/magic-link") {
          return { context: { body: magicLinkBody(ctx.body) } };
        }
        if (ctx.path === "/update-user") {
          return {
            context: { body: await profileUpdate(ctx, ctx.body, hooks.avatarUrlBelongsTo) },
          };
        }
        if (ctx.path === "/change-password") {
          return { context: { body: { ...ctx.body, revokeOtherSessions: true } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email" && rateLimit.limiter && isRecord(ctx.body)) {
          countFailedSignIn(rateLimit.limiter, ctx.body["email"], ctx.context.returned);
        }
        if (ctx.path === "/verify-email") {
          await finishEmailChange(ctx);
        }
        if (ctx.path === "/change-password") {
          const user = changedPasswordUser(ctx.context);
          await revokeBearerCredentials(user?.id ?? null);
          if (user) {
            await notifyPasswordChanged(user, ctx.headers?.get("user-agent"));
          }
        }
      }),
    },
    user: {
      additionalFields: {
        deletionScheduledFor: { type: "date", required: false, input: false },
        termsVersion: { type: "string", required: false, input: false, returned: false },
        termsAcceptedAt: { type: "date", required: false, input: false, returned: false },
      },
      changeEmail: {
        enabled: emailConfigured,
        sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
          deliver(outbox, {
            template: "change-email-confirmation",
            to: user.email,
            data: {
              name: user.name,
              newEmail,
              url,
              expiresInMinutes: verificationTokenExpiresInSeconds / 60,
              securityUrl: appUrl("/forgot-password"),
            },
          }),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path !== "/sign-up/email" || !hooks.termsVersion) {
              return;
            }
            return {
              data: { ...user, termsVersion: hooks.termsVersion, termsAcceptedAt: new Date() },
            };
          },
        },
      },
      session: {
        create: {
          after: async (session, ctx) => {
            if (ctx?.path === "/magic-link/verify") {
              await unprovenPassword.removeAfterMagicLink(session.userId, session.id);
            }
          },
        },
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
      ipAddress: rightmostForwardedAddress,
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: emailConfigured,
      minPasswordLength: passwordMinLength,
      maxPasswordLength: passwordMaxLength,
      onExistingUserSignUp: ({ user }) =>
        deliver(outbox, {
          template: "existing-account-sign-up",
          to: user.email,
          data: {
            name: user.name,
            signInUrl: appUrl("/sign-in"),
            resetUrl: appUrl("/forgot-password"),
          },
        }),
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }, request) => {
        await revokeBearerCredentials(user.id);
        await confirmEmail(user.id);
        await unprovenPassword.clear(user.id);
        await notifyPasswordChanged(user, request?.headers.get("user-agent"));
      },
      resetPasswordTokenExpiresIn: resetPasswordTokenExpiresInSeconds,
      sendResetPassword: ({ user, url }) =>
        deliver(outbox, {
          template: "password-reset",
          to: user.email,
          data: {
            name: user.name,
            url,
            expiresInMinutes: resetPasswordTokenExpiresInSeconds / 60,
          },
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: verificationTokenExpiresInSeconds,
      beforeEmailVerification: (user) => unprovenPassword.markIfPasswordSet(user.id),
      // A change of address reaches this point only after the current mailbox approved it.
      sendVerificationEmail: async ({ user, url, token }) => {
        const expiresInMinutes = verificationTokenExpiresInSeconds / 60;
        const kind = verificationRequest(token).kind;
        await deliver(
          outbox,
          kind === "confirm"
            ? {
                template: "email-verification",
                to: user.email,
                data: { name: user.name, url, expiresInMinutes },
              }
            : {
                template: "change-email-verification",
                to: user.email,
                data: { name: user.name, newEmail: user.email, url, expiresInMinutes },
              },
        );
      },
    },
    plugins: [
      magicLink({
        expiresIn: magicLinkExpiresInSeconds,
        storeToken: "hashed",
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          const [user] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          if (!user) {
            return;
          }
          await deliver(outbox, {
            template: "magic-link",
            to: user.email,
            data: { url, expiresInMinutes: magicLinkExpiresInSeconds / 60 },
          });
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}
