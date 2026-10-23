import { accessMatchers } from "./access-catalog";
import { communityMatchers, migrationMatcher } from "./community-catalogs";
import { moduleValidation } from "./match";
import { paymentsMatchers } from "./payments-catalog";
import type { DescribedError, ErrorAudience, ErrorKind, ErrorMatcher } from "./types";

const matchers: readonly ErrorMatcher[] = [
  ...accessMatchers,
  migrationMatcher,
  ...paymentsMatchers,
  moduleValidation,
  ...communityMatchers,
];

export function describeError(error: unknown, audience?: ErrorAudience): DescribedError | null {
  for (const match of matchers) {
    const described = match(error, audience);
    if (described) return described;
  }
  return null;
}

export const kindStatus = {
  validation: 422,
  unauthenticated: 401,
  payment_required: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  too_large: 413,
  rate_limited: 429,
  unavailable: 503,
} as const satisfies Record<ErrorKind, number>;
