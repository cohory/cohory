import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it } from "vitest";

import { authRateLimitRule, limitAuthRequest } from "./rate-limit";

function post(path: string, ip = "203.0.113.9"): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("auth rate limits", () => {
  it("maps sign up, sign in, and password reset posts to their rules", () => {
    expect(authRateLimitRule("POST", "/api/auth/sign-up/email")).toBe("signUp");
    expect(authRateLimitRule("POST", "/api/auth/sign-in/email")).toBe("signIn");
    expect(authRateLimitRule("POST", "/api/auth/request-password-reset")).toBe("passwordReset");
    expect(authRateLimitRule("POST", "/api/auth/reset-password")).toBe("passwordReset");
    expect(authRateLimitRule("GET", "/api/auth/get-session")).toBeNull();
    expect(authRateLimitRule("POST", "/api/auth/sign-out")).toBeNull();
  });

  it("answers 429 with Retry-After per client address once the limit is reached", async () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, signIn: { max: 2, windowSeconds: 60 } },
    });

    expect(limitAuthRequest(post("/api/auth/sign-in/email"), limiter)).toBeNull();
    expect(limitAuthRequest(post("/api/auth/sign-in/email"), limiter)).toBeNull();
    const refused = limitAuthRequest(post("/api/auth/sign-in/email"), limiter);

    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).toBe("60");
    expect(await refused?.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(limitAuthRequest(post("/api/auth/sign-in/email", "198.51.100.1"), limiter)).toBeNull();
  });

  it("lets everything through when rate limits are disabled", () => {
    const limiter = createRateLimiter({
      rules: { ...rateLimitDefaults, signUp: { max: 1, windowSeconds: 60 } },
      disabled: true,
    });

    for (let i = 0; i < 3; i += 1) {
      expect(limitAuthRequest(post("/api/auth/sign-up/email"), limiter)).toBeNull();
    }
  });
});
