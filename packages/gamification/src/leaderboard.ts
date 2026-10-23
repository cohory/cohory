import type { ScopedQueries } from "@cohory/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const leaderboardWindows = ["7d", "all"] as const;

export type LeaderboardWindow = (typeof leaderboardWindows)[number];

export const leaderboardInputSchema = z.strictObject({
  window: z.enum(leaderboardWindows).default("all"),
});

export type LeaderboardInput = z.input<typeof leaderboardInputSchema>;

export const leaderboardSize = 10;
export const rollingWindowDays = 7;

export interface RankedRow {
  readonly rank: number;
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly username: string | null;
  readonly points: number;
  readonly level: number;
}

const rowSchema = z.object({
  rank: z.coerce.number().int(),
  user_id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  username: z.string().nullable(),
  points: z.coerce.number().int(),
  level: z.coerce.number().int(),
});

function toRows(rows: readonly unknown[]): RankedRow[] {
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return {
      rank: row.rank,
      userId: row.user_id,
      name: row.name,
      image: row.image,
      username: row.username,
      points: row.points,
      level: row.level,
    };
  });
}

export async function rankAllTime(
  { tx, communityId }: ScopedQueries,
  viewerId: string | null,
): Promise<RankedRow[]> {
  const result = await tx.execute(sql`
    with ranked as (
      select s.user_id, u.name, u.image, u.username::text as username,
        s.points_total as points, s.level,
        row_number() over (order by s.points_total desc, s.updated_at asc, s.user_id asc) as rank
      from member_stats s
      join memberships m
        on m.community_id = s.community_id and m.user_id = s.user_id and m.status = 'active'
      join users u on u.id = s.user_id
      where s.community_id = ${communityId} and s.points_total > 0
    )
    select * from ranked
    where rank <= ${leaderboardSize} or user_id = ${viewerId}
    order by rank`);
  return toRows(result.rows);
}

export async function rankWindow(
  { tx, communityId }: ScopedQueries,
  viewerId: string | null,
  since: Date,
): Promise<RankedRow[]> {
  const result = await tx.execute(sql`
    with last_reset as (
      select r.user_id, max(r.occurred_at) as reset_at
      from points_ledger r
      where r.community_id = ${communityId} and r.reason = 'admin_reset'
      group by r.user_id
    ),
    window_points as (
      select l.user_id, sum(l.delta)::integer as points, max(l.occurred_at) as reached_at
      from points_ledger l
      left join last_reset lr on lr.user_id = l.user_id
      where l.community_id = ${communityId} and l.occurred_at >= ${since.toISOString()}
        and l.reason <> 'admin_reset'
        and (lr.reset_at is null or l.occurred_at >= lr.reset_at)
      group by l.user_id
    ),
    ranked as (
      select w.user_id, u.name, u.image, u.username::text as username, w.points,
        coalesce(s.level, 1) as level,
        row_number() over (order by w.points desc, w.reached_at asc, w.user_id asc) as rank
      from window_points w
      join memberships m
        on m.community_id = ${communityId} and m.user_id = w.user_id and m.status = 'active'
      join users u on u.id = w.user_id
      left join member_stats s on s.community_id = ${communityId} and s.user_id = w.user_id
      where w.points > 0
    )
    select * from ranked
    where rank <= ${leaderboardSize} or user_id = ${viewerId}
    order by rank`);
  return toRows(result.rows);
}

export interface ViewerStats {
  readonly level: number;
  readonly points: number;
}

export async function viewerStats(
  { tx, communityId }: ScopedQueries,
  viewerId: string,
): Promise<ViewerStats> {
  const result = await tx.execute(
    sql`select level, points_total as points from member_stats
      where community_id = ${communityId} and user_id = ${viewerId}`,
  );
  const [row] = z
    .array(z.object({ level: z.coerce.number().int(), points: z.coerce.number().int() }))
    .parse(result.rows);
  return row ?? { level: 1, points: 0 };
}

export async function membersPerLevel({
  tx,
  communityId,
}: ScopedQueries): Promise<ReadonlyMap<number, number>> {
  const result = await tx.execute(sql`
    select coalesce(s.level, 1) as level, count(*) as members
    from memberships m
    left join member_stats s on s.community_id = m.community_id and s.user_id = m.user_id
    where m.community_id = ${communityId} and m.status = 'active'
    group by 1`);
  const rows = z
    .array(z.object({ level: z.coerce.number().int(), members: z.coerce.number().int() }))
    .parse(result.rows);
  return new Map(rows.map((row) => [row.level, row.members]));
}
