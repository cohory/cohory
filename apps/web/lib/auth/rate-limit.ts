import {
  clientIp,
  RateLimitedError,
  type RateLimiter,
  type RateLimitRuleName,
} from "@cohory/rate-limit";

const authRules: Readonly<Record<string, RateLimitRuleName>> = {
  "/api/auth/sign-up/email": "signUp",
  "/api/auth/sign-in/email": "signIn",
  "/api/auth/request-password-reset": "passwordReset",
  "/api/auth/reset-password": "passwordReset",
};

export const limitedAuthPaths = Object.keys(authRules);

export function authRateLimitRule(method: string, pathname: string): RateLimitRuleName | null {
  if (method !== "POST") return null;
  return authRules[pathname.replace(/\/+$/, "")] ?? null;
}

export function limitAuthRequest(request: Request, limiter: RateLimiter): Response | null {
  const rule = authRateLimitRule(request.method, new URL(request.url).pathname);
  if (!rule) return null;
  try {
    limiter.consume(rule, clientIp(request.headers));
    return null;
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    const retryAfter = String(Math.max(1, error.retryAfterSeconds));
    return Response.json(
      {
        code: "RATE_LIMITED",
        message: "Too many attempts. Wait a moment and try again.",
      },
      { status: 429, headers: { "Retry-After": retryAfter, "X-Retry-After": retryAfter } },
    );
  }
}
