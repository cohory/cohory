import type { LeaderboardWindow } from "./leaderboard";

export interface LeaderboardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly username: string | null;
  readonly points: number;
  readonly level: number;
  readonly levelName: string;
}

export interface LeaderboardViewer {
  readonly rank: number | null;
  readonly points: number;
  readonly totalPoints: number;
  readonly level: number;
  readonly levelName: string;
}

export interface LadderStep {
  readonly level: number;
  readonly name: string;
  readonly minPoints: number;
  readonly members: number;
  readonly share: number;
}

export interface LearningPoints {
  readonly lessons: boolean;
  readonly events: boolean;
}

export type Leaderboard =
  | { readonly status: "disabled" }
  | {
      readonly status: "enabled";
      readonly window: LeaderboardWindow;
      readonly since: Date | null;
      readonly entries: readonly LeaderboardEntry[];
      readonly viewer: LeaderboardViewer | null;
      readonly ladder: readonly LadderStep[];
      readonly earning: LearningPoints;
    };
