import type { SignUpMode } from "@cohory/config/platform";
import { z } from "zod";

export const joinIntents = ["join", "checkout", "checkout_yearly", "request"] as const;

export type JoinIntent = (typeof joinIntents)[number];

export const joinIntentSchema = z.enum(joinIntents);

export const joinIntentSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const joinIntentCookie = "cohory_join_intent";

export const joinIntentMaxAgeSeconds = 60 * 60;

const continuePattern =
  /^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)\/join\?intent=(join|checkout|checkout_yearly|request)$/;
const inviteAcceptPattern = /^\/join\/([A-Za-z0-9_-]{43})\?accept=1$/;
const postPattern = /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*\/posts\/[0-9a-f-]{36}$/;

export function joinContinuePath(slug: string, intent: JoinIntent): string {
  return `/c/${encodeURIComponent(slug)}/join?intent=${intent}`;
}

export function inviteAcceptPath(token: string): string {
  return `/join/${encodeURIComponent(token)}?accept=1`;
}

export function isJoinContinuePath(path: string): boolean {
  return continuePattern.test(path) || inviteAcceptPattern.test(path);
}

export function signUpOfferedFor(mode: SignUpMode, next: string): boolean {
  return mode === "open" || (mode === "invite" && inviteAcceptPattern.test(next));
}

export type ContinueTarget =
  | { readonly kind: "community"; readonly slug: string; readonly intent: JoinIntent }
  | { readonly kind: "invite"; readonly token: string }
  | { readonly kind: "post" };

export function parseJoinContinuePath(path: string): ContinueTarget | null {
  const join = continuePattern.exec(path);
  const intent = joinIntentSchema.safeParse(join?.[2]);
  if (join?.[1] && intent.success) {
    return { kind: "community", slug: join[1], intent: intent.data };
  }
  const token = inviteAcceptPattern.exec(path)?.[1];
  if (token) {
    return { kind: "invite", token };
  }
  return postPattern.test(path) ? { kind: "post" } : null;
}

export function signUpForJoinPath(slug: string, intent: JoinIntent): string {
  return `/sign-up?next=${encodeURIComponent(joinContinuePath(slug, intent))}`;
}

export function joinIntentCookieValue(slug: string, intent: JoinIntent): string {
  return `${slug}:${intent}`;
}

export function inviteIntentCookieValue(token: string): string {
  return `invite:${token}`;
}

export function autoAcceptInvite(input: {
  readonly accept: unknown;
  readonly signedIn: boolean;
  readonly cookie: string | undefined;
  readonly token: string;
}): boolean {
  return (
    input.accept === "1" && input.signedIn && input.cookie === inviteIntentCookieValue(input.token)
  );
}

interface IntentJar {
  get(name: string): { readonly value: string } | undefined;
  delete(name: string): unknown;
}

export function clearInviteIntent(jar: IntentJar, token: string): void {
  if (jar.get(joinIntentCookie)?.value === inviteIntentCookieValue(token)) {
    jar.delete(joinIntentCookie);
  }
}

export function matchesJoinIntent(
  cookieValue: string | undefined,
  slug: string,
  intent: JoinIntent,
): boolean {
  return cookieValue === joinIntentCookieValue(slug, intent);
}

export function joinFallbackPath(slug: string, intent: JoinIntent): string {
  const base = `/c/${encodeURIComponent(slug)}`;
  switch (intent) {
    case "join":
      return `${base}/about`;
    case "request":
      return `${base}/about?join=request`;
    case "checkout":
    case "checkout_yearly":
      return `${base}/membership`;
  }
}

export type JoinContinuation =
  | { readonly kind: "sign_in" }
  | { readonly kind: "go"; readonly path: string }
  | { readonly kind: "join" }
  | { readonly kind: "checkout"; readonly interval: "month" | "year" }
  | { readonly kind: "request" };

export interface JoinContinuationInput {
  readonly slug: string;
  readonly intent: JoinIntent;
  readonly signedIn: boolean;
  readonly member: boolean;
  readonly cookieMatches: boolean;
  readonly questionCount: number;
}

export function planJoinContinuation(input: JoinContinuationInput): JoinContinuation {
  if (!input.signedIn) {
    return { kind: "sign_in" };
  }
  if (input.member) {
    return { kind: "go", path: `/c/${encodeURIComponent(input.slug)}` };
  }
  if (!input.cookieMatches) {
    return { kind: "go", path: joinFallbackPath(input.slug, input.intent) };
  }
  if (input.intent !== "join" && input.questionCount > 0) {
    return { kind: "go", path: joinFallbackPath(input.slug, input.intent) };
  }
  switch (input.intent) {
    case "join":
    case "request":
      return { kind: input.intent };
    case "checkout":
      return { kind: "checkout", interval: "month" };
    case "checkout_yearly":
      return { kind: "checkout", interval: "year" };
  }
}
