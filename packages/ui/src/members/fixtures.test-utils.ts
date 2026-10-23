import type { LeaderboardEntry } from "./leaderboard";
import type { MemberSummary } from "./types";

export const NOW = new Date("2026-10-18T12:00:00Z");

export function member(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    userId: "u1",
    name: "Ana Lima",
    username: "ana",
    image: null,
    role: "member",
    level: 3,
    levelName: "Regular",
    points: 120,
    joinedAt: "2026-03-04T12:00:00Z",
    ...overrides,
  };
}

export function entry(rank: number, index: number, points: number): LeaderboardEntry {
  return {
    rank,
    points,
    member: { userId: `u${index}`, name: `Person ${index}`, level: 2 },
  };
}
