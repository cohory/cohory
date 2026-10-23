import { createHmac } from "node:crypto";

import type { RateLimiter, RateLimitRuleName } from "@cohory/rate-limit";

import { checkFormToken, createFormToken, type FormTokenCheck } from "./form-token";

export type PublicFormLimit = readonly [rule: RateLimitRuleName, key: string];

export type PublicFormScreen = "ok" | "honeypot" | Exclude<FormTokenCheck, "ok"> | "rate_limited";

export interface PublicFormGuardDeps {
  readonly limiter: Pick<RateLimiter, "check" | "consume">;
  readonly secret: string;
  readonly purpose: string;
  readonly now?: () => Date;
}

export interface PublicFormGuard {
  now(): Date;
  issueToken(): string;
  screen(input: {
    readonly honeypot: string;
    readonly token: string;
    readonly limits: readonly PublicFormLimit[];
  }): PublicFormScreen;
  hashIp(ip: string): string | null;
}

// The spam checks every public form runs, in a fixed order: the honeypot, the signed form
// token, then the rate limits, which are only consumed when every one of them still allows.
export function createPublicFormGuard(deps: PublicFormGuardDeps): PublicFormGuard {
  const now = deps.now ?? (() => new Date());

  function overLimit(limits: readonly PublicFormLimit[]): boolean {
    if (limits.some(([rule, key]) => !deps.limiter.check(rule, key).allowed)) {
      return true;
    }
    for (const [rule, key] of limits) {
      deps.limiter.consume(rule, key);
    }
    return false;
  }

  return {
    now,

    issueToken() {
      return createFormToken(deps.secret, `${deps.purpose}.form-token.v1`, now());
    },

    screen({ honeypot, token, limits }) {
      if (honeypot.trim() !== "") {
        return "honeypot";
      }
      const check = checkFormToken(deps.secret, `${deps.purpose}.form-token.v1`, token, now());
      if (check !== "ok") {
        return check;
      }
      return overLimit(limits) ? "rate_limited" : "ok";
    },

    hashIp(ip) {
      if (ip === "unknown") {
        return null;
      }
      return createHmac("sha256", deps.secret)
        .update(`${deps.purpose}.ip.v1:${ip}`)
        .digest("hex")
        .slice(0, 12);
    },
  };
}
