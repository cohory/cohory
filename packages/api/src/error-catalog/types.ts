export const errorKinds = [
  "validation",
  "unauthenticated",
  "payment_required",
  "forbidden",
  "not_found",
  "conflict",
  "gone",
  "too_large",
  "rate_limited",
  "unavailable",
] as const;

export type ErrorKind = (typeof errorKinds)[number];

export type ErrorAudience = "creator" | "member";

export interface ErrorIssue {
  readonly path: string;
  readonly message: string;
}

type Text<E> = string | ((error: E) => string);

export interface CatalogEntry<E> {
  readonly kind: ErrorKind;
  readonly message: Text<E>;
  readonly creator?: Text<E>;
  readonly member?: Text<E>;
  readonly details?: (error: E) => unknown;
  readonly issues?: (error: E) => readonly ErrorIssue[];
  readonly retryAfterSeconds?: (error: E) => number;
}

export type Catalog<C extends string, E> = { readonly [K in C]: CatalogEntry<E> };

export interface DescribedError {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly issues?: readonly ErrorIssue[];
  readonly retryAfterSeconds?: number;
}

export type ErrorMatcher = (error: unknown, audience?: ErrorAudience) => DescribedError | null;
