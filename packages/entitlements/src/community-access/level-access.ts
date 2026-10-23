import type { ScopedQueries } from "@cohory/db";
import { memberStats, type MemberRole } from "@cohory/db/schema";
import { eq } from "drizzle-orm";

const staffRoles: ReadonlySet<MemberRole> = new Set(["owner", "admin", "moderator"]);

export interface LevelAccessInput {
  readonly role: MemberRole | null;
  readonly level: number;
  readonly requiredLevel: number | null;
}

export function levelUnlocked({ role, level, requiredLevel }: LevelAccessInput): boolean {
  if (requiredLevel === null) return true;
  if (role === null) return false;
  return staffRoles.has(role) || level >= requiredLevel;
}

export async function memberLevelIn(
  { tx, where }: Pick<ScopedQueries, "tx" | "where">,
  userId: string,
): Promise<number> {
  const [row] = await tx
    .select({ level: memberStats.level })
    .from(memberStats)
    .where(where(memberStats, eq(memberStats.userId, userId)));
  return row?.level ?? 1;
}
