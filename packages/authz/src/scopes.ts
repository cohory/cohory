import { z } from "zod";

import type { Actor, CommunityRole } from "./types";

export const scopes = [
  "community:read",
  "posts:read",
  "comments:read",
  "posts:write",
  "comments:write",
  "courses:read",
  "courses:write",
  "events:read",
  "events:write",
  "members:read",
  "members:moderate",
  "members:export",
  "notifications:read",
  "payments:read",
  "settings:read",
  "webhooks:read",
  "webhooks:write",
  "proposals:write",
] as const;

export const scopeSchema = z.enum(scopes);

export type Scope = z.infer<typeof scopeSchema>;

export type ScopeAccess = "read" | "write" | "sensitive";

export interface ScopeDetail {
  readonly label: string;
  readonly description: string;
  readonly memberDescription?: string;
  readonly access: ScopeAccess;
  readonly roles: readonly CommunityRole[];
  readonly pickable: boolean;
  readonly agentOnly?: boolean;
}

const everyone = ["owner", "admin", "moderator", "member"] as const satisfies CommunityRole[];
const staff = ["owner", "admin"] as const satisfies CommunityRole[];

export const scopeDetails: Readonly<Record<Scope, ScopeDetail>> = {
  "community:read": {
    label: "Read the community",
    description: "See the community name, description, About page, and categories.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "posts:read": {
    label: "Read posts",
    description: "Read the feed, single posts, and search results.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "comments:read": {
    label: "Read comments",
    description: "Read comments and replies on posts.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "posts:write": {
    label: "Write posts",
    description:
      "Create, edit, and like posts as you. Posts from an agent wait as drafts until you publish them.",
    access: "write",
    roles: everyone,
    pickable: true,
  },
  "comments:write": {
    label: "Write comments",
    description: "Comment, reply, edit, and like comments as you.",
    access: "write",
    roles: everyone,
    pickable: true,
  },
  "courses:read": {
    label: "Read courses",
    description:
      "Read courses, modules, lessons, and your own progress. It can also mark lessons complete and submit assignments as you.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "courses:write": {
    label: "Edit courses",
    description: "Create and edit courses, modules, and lessons when your role allows it.",
    access: "write",
    roles: staff,
    pickable: true,
  },
  "events:read": {
    label: "Read events",
    description: "Read events, their dates, and your own RSVPs.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "events:write": {
    label: "Edit events",
    description: "Create and edit events when your role allows it, and RSVP as you.",
    access: "write",
    roles: everyone,
    pickable: true,
  },
  "members:read": {
    label: "Read members",
    description: "Search the member directory and read profiles, levels, and the leaderboard.",
    access: "read",
    roles: everyone,
    pickable: true,
  },
  "members:moderate": {
    label: "Moderate members",
    description:
      "Review join requests and reports. Removals, bans, and role changes by an agent always need your approval.",
    access: "write",
    roles: ["owner", "admin", "moderator"],
    pickable: true,
  },
  "members:export": {
    label: "Export members",
    description:
      "Download the members spreadsheet with names and email addresses (owner only). This is personal data. Agents always need your approval.",
    access: "sensitive",
    roles: ["owner"],
    pickable: true,
  },
  "notifications:read": {
    label: "Read notifications",
    description: "Reserved. No API route uses it yet.",
    access: "read",
    roles: [],
    pickable: false,
  },
  "payments:read": {
    label: "Read payments",
    description: "Read the payments overview, plan, subscriptions, and ledger summary.",
    access: "read",
    roles: staff,
    pickable: true,
  },
  "settings:read": {
    label: "Read settings",
    description: "Read community settings, usage, and the audit log.",
    access: "read",
    roles: staff,
    pickable: true,
  },
  "webhooks:read": {
    label: "Read webhooks",
    description: "See webhook endpoints and their delivery logs (owner and admins).",
    access: "read",
    roles: staff,
    pickable: true,
  },
  "webhooks:write": {
    label: "Manage webhooks",
    description:
      "Add, change, test, turn off, and delete webhook endpoints and rotate their secrets (owner and admins).",
    access: "write",
    roles: staff,
    pickable: true,
  },
  "proposals:write": {
    label: "Propose changes",
    description:
      "Ask an owner or admin to approve actions an agent cannot take by itself, such as removing a member. Requests wait in Manage, Approvals.",
    memberDescription:
      "Ask you to buy a membership or a course. Requests wait for you in Account, Agents, and nothing is charged until you finish checkout yourself.",
    access: "write",
    roles: everyone,
    pickable: true,
    agentOnly: true,
  },
};

export const defaultScopes: readonly Scope[] = [
  "community:read",
  "posts:read",
  "comments:read",
  "courses:read",
  "events:read",
];

export const memberAgentScopes: readonly Scope[] = [
  "community:read",
  "posts:read",
  "comments:read",
  "courses:read",
  "events:read",
  "proposals:write",
];

export type ScopeAudience = "staff" | "member";

export function scopeDescription(scope: Scope, audience: ScopeAudience): string {
  const detail = scopeDetails[scope];
  return audience === "member"
    ? (detail.memberDescription ?? detail.description)
    : detail.description;
}

export type ScopeHolder = "token" | "agent" | "personal_agent";

export function availableScopes(role: CommunityRole | null, holder: ScopeHolder): Scope[] {
  if (role === null) {
    return [];
  }
  return scopes.filter((scope) => {
    const detail = scopeDetails[scope];
    if (!detail.pickable || !detail.roles.includes(role)) return false;
    if (holder === "personal_agent") return memberAgentScopes.includes(scope);
    return holder === "agent" || !detail.agentOnly;
  });
}

export const scopeListSchema = z
  .array(scopeSchema)
  .min(1, { error: "Choose at least one permission." })
  .max(scopes.length)
  .transform((list) => scopes.filter((scope) => list.includes(scope)));

export function parseScopes(input: unknown): Scope[] {
  return scopeListSchema.parse(input);
}

export type ScopeCheck = (scope: Scope) => boolean;

export const everyScope: ScopeCheck = () => true;

export function grantedScopes(actor: Actor): ScopeCheck {
  const credential = actor.kind === "user" ? actor.credential : undefined;
  return credential ? (scope) => credential.scopes.includes(scope) : everyScope;
}
