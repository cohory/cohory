export const MIN_LEVEL = 1;
export const MAX_LEVEL = 9;

export type MemberRole = "owner" | "admin" | "moderator" | "member";

export interface MemberSummary {
  userId: string;
  name: string;
  username?: string | null;
  image?: string | null;
  role: MemberRole;
  level: number;
  levelName?: string | null;
  points: number;
  joinedAt: string | Date;
  bio?: string | null;
  isNew?: boolean;
}

export function firstLine(text: string | null | undefined): string | null {
  const line = text
    ?.split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? null;
}

const ROLE_LABELS: Record<Exclude<MemberRole, "member">, string> = {
  owner: "Creator",
  admin: "Admin",
  moderator: "Moderator",
};

export function roleLabel(role: MemberRole): string | null {
  return role === "member" ? null : ROLE_LABELS[role];
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(Math.max(Math.trunc(level), MIN_LEVEL), MAX_LEVEL);
}

export function formatPoints(points: number, locale?: string): string {
  const formatted = new Intl.NumberFormat(locale).format(points);
  return points === 1 ? `${formatted} point` : `${formatted} points`;
}
