import { can, type Actor, type CommunityPrivacy, type CommunityRole } from "@cohory/authz";

export interface CommunityAccess {
  readonly actor: Actor;
  readonly role: CommunityRole | null;
  readonly entitled: boolean;
  readonly privacy: CommunityPrivacy;
}

export interface PostPermissions {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly pin: boolean;
  readonly report: boolean;
}

export interface CommentPermissions {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly report: boolean;
}

export type PostActionId = "edit" | "pin" | "unpin" | "delete" | "report";

function canReport(access: CommunityAccess, authorId: string): boolean {
  const ownsIt = access.actor.kind === "user" && access.actor.userId === authorId;
  return !ownsIt && can(access.actor, "create", "report", context(access));
}

function context(access: CommunityAccess, authorId?: string) {
  const owns =
    authorId === undefined
      ? undefined
      : access.actor.kind === "user" && access.actor.userId === authorId;
  return {
    role: access.role,
    communityPrivacy: access.privacy,
    entitled: access.entitled,
    ownsResource: owns,
  };
}

export function canCreatePost(access: CommunityAccess): boolean {
  return can(access.actor, "create", "post", context(access));
}

export function canCreateComment(access: CommunityAccess): boolean {
  return can(access.actor, "create", "comment", context(access));
}

export function canLike(access: CommunityAccess): boolean {
  return can(access.actor, "like", "post", context(access));
}

export function canEmailMembers(access: CommunityAccess): boolean {
  return access.actor.kind === "user" && can(access.actor, "email_all", "post", context(access));
}

export function canFollow(access: CommunityAccess): boolean {
  return (
    access.actor.kind === "user" &&
    access.role !== null &&
    can(access.actor, "read", "post", context(access))
  );
}

export function postPermissions(access: CommunityAccess, authorId: string): PostPermissions {
  const owned = context(access, authorId);
  return {
    edit: can(access.actor, "edit", "post", owned),
    delete: can(access.actor, "delete", "post", owned),
    pin: can(access.actor, "pin", "post", context(access)),
    report: canReport(access, authorId),
  };
}

export function commentPermissions(access: CommunityAccess, authorId: string): CommentPermissions {
  const owned = context(access, authorId);
  return {
    edit: can(access.actor, "edit", "comment", owned),
    delete: can(access.actor, "delete", "comment", owned),
    report: canReport(access, authorId),
  };
}

export function postActionIds(permissions: PostPermissions, pinned: boolean): PostActionId[] {
  const ids: PostActionId[] = [];
  if (permissions.edit) ids.push("edit");
  if (permissions.pin) ids.push(pinned ? "unpin" : "pin");
  if (permissions.delete) ids.push("delete");
  if (permissions.report) ids.push("report");
  return ids;
}
