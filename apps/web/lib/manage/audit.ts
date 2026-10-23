import type { AuditEntryView } from "@cohory/communities";

const actorTypes = ["user", "agent", "system"] as const;
const vias = ["web", "api", "mcp", "job"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const actorTypeLabels: Readonly<Record<(typeof actorTypes)[number], string>> = {
  user: "People",
  agent: "Agents",
  system: "System",
};

export const viaLabels: Readonly<Record<(typeof vias)[number], string>> = {
  web: "Web app",
  api: "API token",
  mcp: "MCP",
  job: "Background job",
};

export type AuditWho =
  | { readonly kind: "person"; readonly name: string }
  | { readonly kind: "system" }
  | { readonly kind: "agent"; readonly agent: string; readonly owner: string }
  | { readonly kind: "on_request"; readonly person: string; readonly agent: string }
  | {
      readonly kind: "decision";
      readonly person: string;
      readonly verb: "approved" | "rejected";
      readonly agent: string;
    };

const decisionVerbs: Readonly<Record<string, "approved" | "rejected">> = {
  "approval.approved": "approved",
  "approval.rejected": "rejected",
};

export function auditWho(entry: AuditEntryView): AuditWho {
  const person = entry.actor?.name ?? null;
  const verb = decisionVerbs[entry.action];
  if (entry.agent && verb && person) {
    return { kind: "decision", person, verb, agent: entry.agent.name };
  }
  if (entry.agent && entry.actorType === "user" && person) {
    return { kind: "on_request", person, agent: entry.agent.name };
  }
  if (entry.agent) {
    return { kind: "agent", agent: entry.agent.name, owner: person ?? "Former member" };
  }
  return person ? { kind: "person", name: person } : { kind: "system" };
}

export const approvalLifecycleActions = [
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.executed",
  "approval.failed",
  "approval.expired",
  "approval.downloaded",
  "purchase.proposed",
] as const;

const actionLabels: Readonly<Record<string, string>> = {
  "approval.approved": "Request approved",
  "approval.rejected": "Request rejected",
  "approval.executed": "Approved request done",
  "approval.failed": "Approved request could not run",
  "approval.expired": "Request expired",
  "approval.downloaded": "Approved file downloaded",
  "purchase.proposed": "Purchase requested",
  "comp.granted": "Comped access given",
  "comp.revoked": "Comped access removed",
  "comp.expired": "Comped access expired",
  "comp.expiry_changed": "Comped access end date changed",
  "export.audit_log_csv": "Audit log downloaded",
  "export.members_csv": "Members list downloaded",
};

function capitalised(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function keyWords(key: string): string {
  return capitalised(key.replace(/[._]+/g, " "));
}

export function auditActionLabel(action: string): string {
  const known = actionLabels[action];
  if (known) return known;
  if (action.startsWith("api.")) return `${keyWords(action.slice(4))} (API)`;
  return keyWords(action);
}

export interface AuditTarget {
  readonly label: string;
  readonly href: string | null;
}

export function auditTarget(entry: AuditEntryView, slug: string): AuditTarget {
  if (entry.action.startsWith("approval.") || entry.action.startsWith("purchase.")) {
    const summary = entry.metadata?.summary;
    return {
      label: typeof summary === "string" && summary !== "" ? capitalised(summary) : "Agent request",
      href: `/c/${slug}/manage/inbox?tab=approvals&view=history`,
    };
  }
  if (entry.targetName && entry.target) {
    return {
      label: entry.targetName,
      href: `/c/${slug}/manage/people?member=${encodeURIComponent(entry.target)}`,
    };
  }
  if (!entry.target) return { label: "None", href: null };
  if (entry.target.startsWith("/api/")) return { label: "API request", href: null };
  if (uuidPattern.test(entry.target)) return { label: "Item", href: null };
  return { label: entry.target, href: null };
}

export interface AuditDetail {
  readonly label: string;
  readonly value: string;
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

export function auditDetails(metadata: Readonly<Record<string, unknown>> | null): AuditDetail[] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({
    label: keyWords(key.replace(/([A-Z])/g, " $1").toLowerCase()),
    value: detailValue(value),
  }));
}

export interface AuditFilters {
  readonly action?: string;
  readonly actorType?: (typeof actorTypes)[number];
  readonly via?: (typeof vias)[number];
  readonly agentId?: string;
  readonly tokenId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return list.find((item) => item === value);
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function auditFiltersFrom(
  params: Readonly<Record<string, string | string[] | undefined>>,
): AuditFilters {
  const filters: {
    action?: string;
    actorType?: (typeof actorTypes)[number];
    via?: (typeof vias)[number];
    agentId?: string;
    tokenId?: string;
    from?: string;
    to?: string;
    cursor?: string;
  } = {};
  for (const key of ["action", "from", "to", "cursor"] as const) {
    const value = single(params[key]);
    if (value) filters[key] = value;
  }
  for (const key of ["agentId", "tokenId"] as const) {
    const value = single(params[key]);
    if (value && uuidPattern.test(value)) filters[key] = value;
  }
  const actorType = oneOf(actorTypes, single(params.actorType));
  if (actorType) filters.actorType = actorType;
  const via = oneOf(vias, single(params.via));
  if (via) filters.via = via;
  return filters;
}

export function auditQuery(filters: AuditFilters, extra: Readonly<Record<string, string>> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
