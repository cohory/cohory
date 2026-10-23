import { MAX_LEVEL } from "@cohory/ui";
import { z } from "zod";

export const leaderboardWindowOptions = ["7d", "all"] as const;

export type LeaderboardWindowParam = (typeof leaderboardWindowOptions)[number];

export const maxQueryLength = 80;

type SearchParamValue = string | string[] | undefined;
export type RawSearchParams = Readonly<Record<string, SearchParamValue>>;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const levelParam = z.coerce.number().int().min(1).max(MAX_LEVEL);

export interface DirectoryParams {
  readonly q: string;
  readonly level: number | null;
}

export function parseDirectoryParams(params: RawSearchParams): DirectoryParams {
  const q = (first(params.q) ?? "").slice(0, maxQueryLength);
  const rawLevel = first(params.level);
  const level = rawLevel ? levelParam.safeParse(rawLevel) : null;
  return { q, level: level?.success ? level.data : null };
}

export function directoryHref(slug: string, params: DirectoryParams): string {
  const search = new URLSearchParams();
  if (params.q.trim()) search.set("q", params.q);
  if (params.level !== null) search.set("level", String(params.level));
  const query = search.toString();
  return `/c/${slug}/members${query ? `?${query}` : ""}`;
}

export const defaultLeaderboardWindow: LeaderboardWindowParam = "7d";

export function parseLeaderboardWindow(params: RawSearchParams): LeaderboardWindowParam {
  const parsed = z.enum(leaderboardWindowOptions).safeParse(first(params.window));
  return parsed.success ? parsed.data : defaultLeaderboardWindow;
}
