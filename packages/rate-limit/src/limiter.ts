import { parseRateLimitEnv, type RateLimitRuleName, type RateLimitRules } from "./config";
import { RateLimitedError } from "./errors";
import { normalizeIp } from "./ip";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitTake extends RateLimitDecision {
  readonly limit: number;
  readonly resetSeconds: number;
}

export interface RateLimiter {
  check(rule: RateLimitRuleName, key: string): RateLimitDecision;
  consume(rule: RateLimitRuleName, key: string): void;
  take(rule: RateLimitRuleName, key: string): RateLimitTake;
  size(): number;
}

export interface RateLimiterOptions {
  readonly rules: RateLimitRules;
  readonly disabled?: boolean;
  readonly now?: () => number;
}

interface Window {
  count: number;
  readonly resetAt: number;
}

const sweepEvery = 1000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();
  let writes = 0;

  function sweep(at: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) {
        windows.delete(key);
      }
    }
  }

  function current(rule: RateLimitRuleName, key: string, at: number): Window | undefined {
    const window = windows.get(`${rule}:${key}`);
    return window && window.resetAt > at ? window : undefined;
  }

  function decide(rule: RateLimitRuleName, key: string, at: number): RateLimitDecision {
    const { max } = options.rules[rule];
    const window = current(rule, key, at);
    const used = window?.count ?? 0;
    return {
      allowed: options.disabled === true || used < max,
      remaining: Math.max(0, max - used),
      retryAfterSeconds: window ? Math.ceil((window.resetAt - at) / 1000) : 0,
    };
  }

  return {
    check(rule, key) {
      return decide(rule, key, now());
    },

    consume(rule, key) {
      if (options.disabled) {
        return;
      }
      const at = now();
      writes += 1;
      if (writes % sweepEvery === 0) {
        sweep(at);
      }
      const decision = decide(rule, key, at);
      if (!decision.allowed) {
        throw new RateLimitedError(rule, decision.retryAfterSeconds);
      }
      const window = current(rule, key, at);
      if (window) {
        window.count += 1;
        return;
      }
      windows.set(`${rule}:${key}`, {
        count: 1,
        resetAt: at + options.rules[rule].windowSeconds * 1000,
      });
    },

    take(rule, key) {
      const { max, windowSeconds } = options.rules[rule];
      const at = now();
      if (options.disabled) {
        return {
          allowed: true,
          limit: max,
          remaining: max,
          resetSeconds: windowSeconds,
          retryAfterSeconds: 0,
        };
      }
      writes += 1;
      if (writes % sweepEvery === 0) {
        sweep(at);
      }
      let window = current(rule, key, at);
      if (!window) {
        window = { count: 0, resetAt: at + windowSeconds * 1000 };
        windows.set(`${rule}:${key}`, window);
      }
      const resetSeconds = Math.ceil((window.resetAt - at) / 1000);
      if (window.count >= max) {
        return {
          allowed: false,
          limit: max,
          remaining: 0,
          resetSeconds,
          retryAfterSeconds: resetSeconds,
        };
      }
      window.count += 1;
      return {
        allowed: true,
        limit: max,
        remaining: max - window.count,
        resetSeconds,
        retryAfterSeconds: 0,
      };
    },

    size() {
      sweep(now());
      return windows.size;
    },
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .at(-1);
  const address = forwarded || headers.get("x-real-ip")?.trim();
  return address ? normalizeIp(address) : "unknown";
}

export type RateKeyActor =
  { readonly kind: "guest" } | { readonly kind: "user"; readonly userId: string };

export function rateLimitKey(actor: RateKeyActor, headers: Headers): string {
  return actor.kind === "user" ? userRateLimitKey(actor.userId) : `ip:${clientIp(headers)}`;
}

export function userRateLimitKey(userId: string): string {
  return `user:${userId}`;
}

let defaultLimiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (!defaultLimiter) {
    const config = parseRateLimitEnv();
    defaultLimiter = createRateLimiter({ rules: config.rules, disabled: config.disabled });
  }
  return defaultLimiter;
}
