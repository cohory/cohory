import "#server-only";

import { getAgentsService } from "@cohory/agents";
import { getLegalConfig, signUpConsent } from "@cohory/config/legal";
import { getPlatformConfig, parseEdition } from "@cohory/config/platform";
import { getDb } from "@cohory/db";
import { getEmailOutbox, getMailer, parseEmailEnv } from "@cohory/email";
import { getRateLimiter, parseRateLimitEnv } from "@cohory/rate-limit";
import { getStorage } from "@cohory/storage";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { ownAvatarUrl } from "./avatar";
import { parseAuthEnv } from "./env";
import { createAuthOptions } from "./options";
import { noSignUpLookups, signUpGate, type SignUpLookups } from "./sign-up-gate";

export function createAuth(options: ReturnType<typeof createAuthOptions>) {
  return betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] });
}

export type Auth = ReturnType<typeof createAuth>;

export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

let defaultAuth: Auth | undefined;

export function emailSendingConfigured(): boolean {
  return parseEmailEnv().driver === "smtp";
}

export interface InstanceAuthOptions {
  readonly signUpLookups: SignUpLookups;
}

// Builds auth from the environment. Without lookups an invite only server refuses every sign up.
export function createInstanceAuth(
  options: InstanceAuthOptions = { signUpLookups: noSignUpLookups },
): Auth {
  return createAuth(
    createAuthOptions(
      getDb(),
      parseAuthEnv(),
      getMailer(),
      { disabled: parseRateLimitEnv().disabled, limiter: getRateLimiter() },
      {
        credentials: getAgentsService(),
        avatarUrlBelongsTo: (userId, url) => ownAvatarUrl(getStorage())(userId, url),
        emailOutbox: getEmailOutbox(),
        emailConfigured: emailSendingConfigured(),
        termsVersion: signUpConsent(getLegalConfig(), parseEdition()).termsVersion,
        signUpAllowed: signUpGate(getPlatformConfig().signUpMode, options.signUpLookups),
        appName: getPlatformConfig().instance.name,
      },
    ),
  );
}

export function getAuth(): Auth {
  defaultAuth ??= createInstanceAuth();
  return defaultAuth;
}
