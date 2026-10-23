import type { MemberAccessKind } from "@cohory/payments";

export const maxInactiveDays = 3650;

export const inactivePresets = [7, 14, 30, 60, 90] as const;

const dayMs = 24 * 60 * 60 * 1000;
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function lastActiveLabel(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / dayMs);
  if (days < 1) {
    return "Last active today";
  }
  if (days < 30) {
    return `Last active ${relative.format(-days, "day")}`;
  }
  if (days < 365) {
    return `Last active ${relative.format(-Math.floor(days / 30), "month")}`;
  }
  return `Last active ${relative.format(-Math.floor(days / 365), "year")}`;
}

export function personActivityLabel(
  person: { readonly signedInYet: boolean; readonly lastActiveAt: string },
  now: Date = new Date(),
): string {
  return person.signedInYet ? lastActiveLabel(person.lastActiveAt, now) : "Not signed in yet";
}

export function parseInactiveDays(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }
  const days = Number(raw);
  return days >= 1 && days <= maxInactiveDays ? days : null;
}

export type AccessFilter = MemberAccessKind | "paying" | "none";

export const accessLabels: Readonly<Record<AccessFilter, string>> = {
  paying: "Any paid subscription",
  paying_monthly: "Paying monthly",
  paying_yearly: "Paying yearly",
  free_access: "Free access",
  past_due: "Past due",
  cancelling: "Cancelling",
  none: "No paid access",
};

export const accessFilters = [
  "paying",
  "paying_monthly",
  "paying_yearly",
  "free_access",
  "past_due",
  "cancelling",
  "none",
] as const satisfies readonly AccessFilter[];

export const roleFilters = ["owner", "admin", "moderator", "member"] as const;
export type RoleFilter = (typeof roleFilters)[number];

export const statusFilters = ["active", "removed", "banned"] as const;
export type StatusFilter = (typeof statusFilters)[number];

export const activityFilters = [
  "any",
  ...inactivePresets.map((days) => `${days}` as const),
  "custom",
  "never",
] as const;
export type ActivityFilter = (typeof activityFilters)[number];

export interface PeopleFilters {
  readonly query: string;
  readonly role: RoleFilter | "";
  readonly status: StatusFilter;
  readonly activity: ActivityFilter;
  readonly customDays: string;
  readonly access: AccessFilter | "";
}

export const defaultPeopleFilters: PeopleFilters = {
  query: "",
  role: "",
  status: "active",
  activity: "any",
  customDays: "",
  access: "",
};

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function one(params: RawParams, key: string): string {
  const value = params[key];
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

function pick<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function linkedActivity(params: RawParams): Pick<PeopleFilters, "activity" | "customDays"> {
  const days = parseInactiveDays(one(params, "inactiveDays"));
  if (days === null) {
    return { activity: "any", customDays: "" };
  }
  const preset = activityFilters.find((value) => value === `${days}`);
  return preset
    ? { activity: preset, customDays: "" }
    : { activity: "custom", customDays: `${days}` };
}

export function parsePeopleFilters(params: RawParams): PeopleFilters {
  const activity = pick(activityFilters, one(params, "activity"), "any");
  const access = pick<AccessFilter | "">(accessFilters, one(params, "access"), "");
  return {
    query: one(params, "q").slice(0, 80),
    role: pick<RoleFilter | "">(roleFilters, one(params, "role"), ""),
    status: pick(statusFilters, one(params, "status"), "active"),
    ...(activity === "any"
      ? linkedActivity(params)
      : { activity, customDays: one(params, "days").slice(0, 4) }),
    access: access === "" && one(params, "paid") === "1" ? "paying" : access,
  };
}

export interface PeopleLink {
  readonly role?: RoleFilter;
  readonly inactiveDays?: number;
  readonly paid?: boolean;
}

export function peopleHref(slug: string, link: PeopleLink): string {
  const params = new URLSearchParams();
  if (link.role) params.set("role", link.role);
  if (link.inactiveDays !== undefined) params.set("inactiveDays", String(link.inactiveDays));
  if (link.paid) params.set("paid", "1");
  const search = params.toString();
  return `/c/${encodeURIComponent(slug)}/manage/people${search ? `?${search}` : ""}`;
}

export function peopleFiltersToParams(filters: PeopleFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.role) params.set("role", filters.role);
  if (filters.status !== defaultPeopleFilters.status) params.set("status", filters.status);
  if (filters.activity !== "any") params.set("activity", filters.activity);
  if (filters.activity === "custom" && filters.customDays) params.set("days", filters.customDays);
  if (filters.access) params.set("access", filters.access);
  return params;
}

export interface MemberFilters {
  readonly query?: string;
  readonly role?: RoleFilter;
  readonly status?: StatusFilter;
  readonly inactiveDays?: number;
  readonly neverSignedIn?: boolean;
  readonly access?: AccessFilter;
}

export function peopleFiltersToInput(filters: PeopleFilters): MemberFilters | null {
  const query = filters.query.trim();
  const shared = {
    ...(query ? { query } : {}),
    ...(filters.role ? { role: filters.role } : {}),
  };
  const access = filters.access ? { access: filters.access } : {};
  if (filters.activity === "any" || filters.activity === "never") {
    return {
      ...shared,
      status: filters.status,
      ...(filters.activity === "never" ? { neverSignedIn: true } : {}),
      ...access,
    };
  }
  const inactiveDays =
    filters.activity === "custom"
      ? parseInactiveDays(filters.customDays)
      : Number(filters.activity);
  return inactiveDays === null ? null : { ...shared, inactiveDays, ...access };
}

export function activeFilterCount(filters: PeopleFilters): number {
  return [
    filters.role !== "",
    filters.status !== defaultPeopleFilters.status,
    filters.activity !== "any",
    filters.access !== "",
  ].filter(Boolean).length;
}

export function membersCsvHref(slug: string, filters: MemberFilters): string {
  const params = new URLSearchParams();
  const query = filters.query?.trim();
  if (query) params.set("query", query);
  if (filters.role) params.set("role", filters.role);
  if (filters.inactiveDays !== undefined) {
    params.set("inactiveDays", String(filters.inactiveDays));
  } else if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.access) params.set("access", filters.access);
  if (filters.neverSignedIn) params.set("neverSignedIn", "true");
  const search = params.toString();
  return `/api/v1/communities/${encodeURIComponent(slug)}/manage/export/members.csv${search ? `?${search}` : ""}`;
}
