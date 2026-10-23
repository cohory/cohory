import { can, type Actor, type CommunityRole } from "@cohory/authz";

export const settingsSections = [
  "general",
  "joining",
  "categories",
  "points",
  "agents",
  "webhooks",
  "audit-log",
  "danger-zone",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const settingsSectionLabels: Readonly<Record<SettingsSection, string>> = {
  general: "General",
  joining: "Joining",
  categories: "Categories",
  points: "Points",
  agents: "Agents",
  webhooks: "Webhooks",
  "audit-log": "Audit log",
  "danger-zone": "Danger zone",
};

export function settingsSectionsFor(actor: Actor, role: CommunityRole): SettingsSection[] {
  const context = { role };
  return settingsSections.filter((section) => {
    if (section === "agents") return can(actor, "read", "agent", context);
    if (section === "webhooks") return can(actor, "manage", "webhook", context);
    if (section === "audit-log") return can(actor, "read", "audit_log", context);
    if (section === "danger-zone") return can(actor, "transfer_ownership", "community", context);
    return can(actor, "read", "settings", context);
  });
}

export function settingsSectionHref(slug: string, section: SettingsSection): string {
  const base = `/c/${slug}/manage/settings`;
  return section === "general" ? base : `${base}/${section}`;
}
