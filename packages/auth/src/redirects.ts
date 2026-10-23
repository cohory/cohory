const fallback = "/";

function isProtocolRelative(path: string): boolean {
  return path.startsWith("//") || path.startsWith("/\\");
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || isProtocolRelative(value)) {
    return fallback;
  }
  const resolved = new URL(value, "http://placeholder.invalid");
  if (resolved.origin !== "http://placeholder.invalid") {
    return fallback;
  }
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return isProtocolRelative(path) ? fallback : path;
}

export function signInPath(returnTo?: string): string {
  const next = safeRedirectPath(returnTo);
  return next === fallback ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
}

export const verifiedPage = "/verified";

export function verifiedPath(returnTo?: unknown): string {
  const next = safeRedirectPath(returnTo);
  if (new URL(next, "http://placeholder.invalid").pathname === verifiedPage) {
    return next;
  }
  return next === fallback ? verifiedPage : `${verifiedPage}?next=${encodeURIComponent(next)}`;
}

export const pendingDeletionPath = "/cancel-deletion";

export function isDeletionPending(user: { deletionScheduledFor?: Date | null }): boolean {
  return user.deletionScheduledFor !== null && user.deletionScheduledFor !== undefined;
}
