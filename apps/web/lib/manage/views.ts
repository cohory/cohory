import { can, type Actor, type CommunityRole } from "@cohory/authz";
import { parseAppUrl } from "@cohory/config/platform";
import {
  assignableRoles,
  type AssignableRole,
  type InviteLinkView,
  type ManageMember,
} from "@cohory/communities";
import type { MemberAccessKind } from "@cohory/payments";
import type { ReportReason, ReportStatus } from "@cohory/db/schema";
import type { ReportGroupView } from "@cohory/posts";

export interface ModeTokens {
  readonly accent: string;
  readonly accentHover: string;
  readonly accentForeground: string;
  readonly accentMuted: string;
  readonly ring: string;
}

export interface PersonActions {
  readonly roles: readonly AssignableRole[];
  readonly remove: boolean;
  readonly ban: boolean;
  readonly unban: boolean;
  readonly resetPoints: boolean;
}

export interface PersonRow {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly email: string | null;
  readonly role: ManageMember["role"];
  readonly status: ManageMember["status"];
  readonly joinedAt: string | null;
  readonly lastActiveAt: string;
  readonly signedInYet: boolean;
  readonly access: MemberAccessKind | "none" | null;
  readonly accessUntil: string | null;
  readonly level: number;
  readonly points: number;
  readonly actions: PersonActions;
}

export interface InviteRow {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string | null;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly requiresApproval: boolean;
  readonly label: string | null;
  readonly revokedAt: string | null;
  readonly status: InviteLinkView["status"];
}

export interface Viewer {
  readonly actor: Actor;
  readonly role: CommunityRole;
}

const noActions: PersonActions = {
  roles: [],
  remove: false,
  ban: false,
  unban: false,
  resetPoints: false,
};

export function personActions(viewer: Viewer, member: ManageMember): PersonActions {
  if (viewer.actor.kind !== "user") {
    return noActions;
  }
  const context = {
    role: viewer.role,
    target: { role: member.role, isSelf: member.userId === viewer.actor.userId },
  };
  const active = member.status === "active";
  const canChangeRole = active && can(viewer.actor, "change_role", "membership", context);
  const canAssignAdmin = can(viewer.actor, "assign_admin", "membership", { role: viewer.role });
  const canBan = can(viewer.actor, "ban", "membership", context);
  return {
    roles: canChangeRole
      ? assignableRoles.filter(
          (role) => role !== member.role && (role !== "admin" || canAssignAdmin),
        )
      : [],
    remove:
      (active || member.status === "pending") && can(viewer.actor, "remove", "membership", context),
    ban: member.status !== "banned" && canBan,
    unban: member.status === "banned" && canBan,
    resetPoints:
      active &&
      member.points !== 0 &&
      can(viewer.actor, "reset_points", "membership", { role: viewer.role }),
  };
}

export function toPersonRow(viewer: Viewer, member: ManageMember): PersonRow {
  return {
    userId: member.userId,
    name: member.name,
    username: member.username,
    image: member.image,
    email: member.email,
    role: member.role,
    status: member.status,
    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
    lastActiveAt: member.lastActiveAt.toISOString(),
    signedInYet: member.signedIn,
    access: member.access?.kind ?? null,
    accessUntil: member.access?.until?.toISOString() ?? null,
    level: member.level,
    points: member.points,
    actions: personActions(viewer, member),
  };
}

export function inviteUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}

export function toInviteRow(appUrl: string, invite: InviteLinkView): InviteRow {
  return {
    id: invite.id,
    url: inviteUrl(appUrl, invite.path),
    expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    requiresApproval: invite.requiresApproval,
    label: invite.label,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    status: invite.status,
  };
}

export function appUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return parseAppUrl(env);
}

export interface ReportRow {
  readonly type: "post" | "comment";
  readonly id: string;
  readonly postId: string;
  readonly postTitle: string | null;
  readonly excerpt: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly canBan: boolean;
  readonly deleted: boolean;
  readonly status: ReportStatus;
  readonly reportCount: number;
  readonly reasons: readonly ReportReason[];
  readonly notes: readonly string[];
  readonly lastReportedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export function toReportRow(viewer: Viewer, group: ReportGroupView): ReportRow {
  const { author } = group.content;
  const canBan =
    author.role !== null &&
    can(viewer.actor, "ban", "membership", {
      role: viewer.role,
      target: {
        role: author.role,
        isSelf: viewer.actor.kind === "user" && author.id === viewer.actor.userId,
      },
    });
  return {
    type: group.content.type,
    id: group.content.id,
    postId: group.content.postId,
    postTitle: group.content.postTitle,
    excerpt: group.content.excerpt,
    authorId: author.id,
    authorName: author.name,
    canBan,
    deleted: group.content.deletedAt !== null,
    status: group.status,
    reportCount: group.reportCount,
    reasons: group.reasons,
    notes: group.notes,
    lastReportedAt: group.lastReportedAt.toISOString(),
    resolvedAt: group.resolvedAt?.toISOString() ?? null,
    resolvedBy: group.resolvedBy,
  };
}
