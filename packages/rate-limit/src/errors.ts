import type { RateLimitRuleName } from "./config";

export class RateLimitedError extends Error {
  readonly code = "rate_limited";

  constructor(
    readonly rule: RateLimitRuleName,
    readonly retryAfterSeconds: number,
  ) {
    super(`rate limit ${rule} reached`);
    this.name = "RateLimitedError";
  }
}
