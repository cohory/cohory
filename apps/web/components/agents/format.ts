import { formatDate } from "@cohory/ui/lib/format-date";

export function formatDay(iso: string | null, empty = "Never"): string {
  return iso ? formatDate(iso, { timeZone: "UTC" }) : empty;
}

export const expiryChoices = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
] as const;

export const tokenStateLabels = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
} as const;

export const selectClass =
  "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type TokenVia = "web" | "api" | "mcp" | "job";

export const viaLabels: Readonly<Record<TokenVia, string>> = {
  web: "in the web app",
  api: "via API",
  mcp: "via MCP",
  job: "by a job",
};

const dayMs = 24 * 60 * 60 * 1000;
export const expiryWarningDays = 7;

export function daysLeft(expiresAt: string, now: Date): number {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / dayMs);
}

export function expiresSoon(
  token: { readonly state: keyof typeof tokenStateLabels; readonly expiresAt: string },
  now: Date,
): boolean {
  return token.state === "active" && daysLeft(token.expiresAt, now) <= expiryWarningDays;
}

export function expiryNote(expiresAt: string, now: Date): string {
  const days = daysLeft(expiresAt, now);
  if (days <= 1) return "Expires within a day";
  return `Expires in ${days} days`;
}

export function partitionTokens<T extends { readonly state: keyof typeof tokenStateLabels }>(
  items: readonly T[],
): { live: T[]; ended: T[] } {
  return {
    live: items.filter((item) => item.state === "active"),
    ended: items.filter((item) => item.state !== "active"),
  };
}

export const linkButtonClass =
  "min-h-11 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";
