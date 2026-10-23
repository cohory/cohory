import type { CommunityRole } from "@cohory/authz";

export const manageSections = [
  "overview",
  "inbox",
  "people",
  "payments",
  "appearance",
  "settings",
  "migration",
] as const;

export type ManageSection = (typeof manageSections)[number];

export const manageSectionLabels: Readonly<Record<ManageSection, string>> = {
  overview: "Overview",
  inbox: "Inbox",
  people: "People",
  payments: "Payments",
  appearance: "Appearance",
  settings: "Settings",
  migration: "Migration",
};

export function manageSectionsFor(role: CommunityRole | null): readonly ManageSection[] {
  if (role === "owner" || role === "admin") {
    return manageSections;
  }
  if (role === "moderator") {
    return ["inbox", "people"];
  }
  return [];
}

export const moderatorScope =
  "You are a moderator. You can approve requests, review reports, and remove or ban members.";

export type ManageQuery = Readonly<Record<string, string | readonly string[] | undefined>>;

export type ManageEntry =
  | { readonly kind: "sign_in"; readonly next: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "redirect"; readonly href: string }
  | { readonly kind: "open"; readonly sections: readonly ManageSection[] };

function withQuery(path: string, query: ManageQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of typeof value === "string" ? [value] : (value ?? [])) {
      search.append(key, item);
    }
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export function manageEntry(
  slug: string,
  actorKind: "guest" | "user",
  role: CommunityRole | null,
  section?: ManageSection,
  query: ManageQuery = {},
): ManageEntry {
  if (actorKind === "guest") {
    return {
      kind: "sign_in",
      next: withQuery(manageSectionHref(slug, section ?? "overview"), query),
    };
  }
  const sections = manageSectionsFor(role);
  const first = sections[0];
  if (first === undefined) {
    return { kind: "not_found" };
  }
  if (section !== undefined && !sections.includes(section)) {
    return { kind: "redirect", href: manageSectionHref(slug, first) };
  }
  return { kind: "open", sections };
}

export function manageSectionHref(slug: string, section: ManageSection): string {
  const base = `/c/${slug}/manage`;
  return section === "overview" ? base : `${base}/${section}`;
}
