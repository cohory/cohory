import { describe, expect, it } from "vitest";

import { parseRateLimitEnv, rateLimitDefaults } from "./config";
import { RateLimitedError } from "./errors";
import { clientIp, createRateLimiter, rateLimitKey, userRateLimitKey } from "./limiter";

function clock(start = Date.UTC(2026, 9, 18, 10)) {
  let now = start;
  return {
    now: () => now,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows up to the limit per key within a window and then refuses with a retry time", () => {
    const time = clock();
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, post: { max: 2, windowSeconds: 60 } },
      now: time.now,
    });

    limiter.consume("post", "user-a");
    limiter.consume("post", "user-a");
    time.advance(15);

    expect(() => limiter.consume("post", "user-a")).toThrow(RateLimitedError);
    try {
      limiter.consume("post", "user-a");
    } catch (error) {
      expect(error).toMatchObject({ code: "rate_limited", rule: "post", retryAfterSeconds: 45 });
    }
    expect(() => limiter.consume("post", "user-b")).not.toThrow();
    expect(() => limiter.consume("comment", "user-a")).not.toThrow();
  });

  it("takes a request and reports limit, remaining, and reset without throwing", () => {
    const time = clock();
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, apiToken: { max: 2, windowSeconds: 60 } },
      now: time.now,
    });

    expect(limiter.take("apiToken", "token-a")).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSeconds: 60,
      retryAfterSeconds: 0,
    });
    time.advance(20);
    expect(limiter.take("apiToken", "token-a")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.take("apiToken", "token-a")).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetSeconds: 40,
      retryAfterSeconds: 40,
    });
    expect(limiter.take("apiToken", "token-b")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("takes without counting when disabled", () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, apiToken: { max: 1, windowSeconds: 60 } },
      disabled: true,
    });

    limiter.take("apiToken", "token-a");
    expect(limiter.take("apiToken", "token-a")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("starts a fresh window after the old one ends", () => {
    const time = clock();
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, signIn: { max: 1, windowSeconds: 10 } },
      now: time.now,
    });

    limiter.consume("signIn", "1.2.3.4");
    time.advance(10);

    expect(() => limiter.consume("signIn", "1.2.3.4")).not.toThrow();
  });

  it("reports without consuming through check", () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, rsvp: { max: 1, windowSeconds: 60 } },
      now: clock().now,
    });

    expect(limiter.check("rsvp", "u").allowed).toBe(true);
    limiter.consume("rsvp", "u");
    expect(limiter.check("rsvp", "u")).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("never refuses when disabled", () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, post: { max: 1, windowSeconds: 60 } },
      disabled: true,
    });

    for (let i = 0; i < 5; i += 1) {
      limiter.consume("post", "user-a");
    }
    expect(limiter.check("post", "user-a").allowed).toBe(true);
  });

  it("drops expired windows so memory stays bounded", () => {
    const time = clock();
    const limiter = createRateLimiter({ rules: rateLimitDefaults, now: time.now });
    for (let i = 0; i < 50; i += 1) {
      limiter.consume("reaction", `user-${i}`);
    }
    time.advance(3600);
    limiter.consume("reaction", "late");

    expect(limiter.size()).toBe(1);
  });
});

describe("parseRateLimitEnv", () => {
  it("uses the defaults when nothing is set", () => {
    expect(parseRateLimitEnv({})).toEqual({ disabled: false, rules: rateLimitDefaults });
  });

  it("reads max per window seconds overrides and the kill switch", () => {
    const parsed = parseRateLimitEnv({
      RATE_LIMIT_DISABLED: "true",
      RATE_LIMIT_SIGN_UP: "20/60",
      RATE_LIMIT_POSTS: "1/1",
    });

    expect(parsed.disabled).toBe(true);
    expect(parsed.rules.signUp).toEqual({ max: 20, windowSeconds: 60 });
    expect(parsed.rules.post).toEqual({ max: 1, windowSeconds: 1 });
    expect(parsed.rules.comment).toEqual(rateLimitDefaults.comment);
  });

  it("limits failed sign ins per account separately from the per address limit", () => {
    expect(rateLimitDefaults.signInAccount).toEqual({ max: 50, windowSeconds: 900 });
    expect(parseRateLimitEnv({ RATE_LIMIT_SIGN_IN_ACCOUNT: "20/600" }).rules.signInAccount).toEqual(
      { max: 20, windowSeconds: 600 },
    );
  });

  it("rejects malformed values instead of silently ignoring them", () => {
    expect(() => parseRateLimitEnv({ RATE_LIMIT_SIGN_IN: "lots" })).toThrow();
    expect(() => parseRateLimitEnv({ RATE_LIMIT_SIGN_IN: "0/60" })).toThrow();
    expect(() => parseRateLimitEnv({ RATE_LIMIT_DISABLED: "yes" })).toThrow();
  });
});

describe("clientIp", () => {
  it("takes the address the proxy appended last, then the real ip header, then a shared bucket", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("ignores forwarded entries a client sent ahead of the proxy's own entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, , 203.0.113.5, " }))).toBe(
      "203.0.113.5",
    );
  });

  it("groups IPv6 addresses by their /64 so one network shares a bucket", () => {
    const first = clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2::1" }));
    const second = clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2::ffff" }));
    const otherNetwork = clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:3::1" }));

    expect(first).toBe(second);
    expect(otherNetwork).not.toBe(first);

    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, signIn: { max: 2, windowSeconds: 60 } },
      now: clock().now,
    });
    limiter.consume("signIn", first);
    limiter.consume("signIn", second);
    expect(() => limiter.consume("signIn", first)).toThrow(RateLimitedError);
    expect(() => limiter.consume("signIn", otherNetwork)).not.toThrow();
  });

  it("gives every textual form of one IPv6 network the same key", () => {
    const forms = [
      "2001:db8:1:2::1",
      "2001:0DB8:0001:0002:0000:0000:0000:0001",
      "2001:db8:1:2:0:0:0:1",
      "[2001:db8:1:2::1]",
      "2001:db8:1:2::1%eth0",
    ];
    const keys = new Set(forms.map((form) => clientIp(new Headers({ "x-real-ip": form }))));
    expect(keys.size).toBe(1);
  });

  it("maps IPv4 mapped IPv6 addresses to the plain IPv4 address", () => {
    const forms = [
      "203.0.113.5",
      "::ffff:203.0.113.5",
      "::FFFF:cb00:7105",
      "0:0:0:0:0:ffff:203.0.113.5",
    ];
    for (const form of forms) {
      expect(clientIp(new Headers({ "x-forwarded-for": form }))).toBe("203.0.113.5");
    }
  });
});

describe("rateLimitKey", () => {
  it("keys signed in people by user id and everyone else by client address, on every surface", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    expect(rateLimitKey({ kind: "user", userId: "u-1" }, headers)).toBe("user:u-1");
    expect(rateLimitKey({ kind: "guest" }, headers)).toBe("ip:198.51.100.7");
    expect(userRateLimitKey("u-1")).toBe("user:u-1");
  });
});
