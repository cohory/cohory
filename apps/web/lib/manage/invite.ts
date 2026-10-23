import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import {
  CommunityArchivedError,
  CommunityNotFoundError,
  InviteNotFoundError,
  InviteUnavailableError,
  type InvitePreview,
} from "@cohory/communities";

export type JoinInviteState = { status: "idle" } | { status: "error"; message: string };

export const inviteMessages = {
  unavailable: "This invite link has expired or is no longer active. Ask for a new one.",
  banned: "You can't join this community.",
  archived: "This community is archived and isn't taking new members.",
  signedOut: "Sign in to join this community.",
} as const;

export function inviteFailureMessage(error: unknown): string | null {
  if (
    error instanceof InviteUnavailableError ||
    error instanceof InviteNotFoundError ||
    error instanceof CommunityNotFoundError
  ) {
    return inviteMessages.unavailable;
  }
  if (error instanceof ForbiddenError) {
    return inviteMessages.banned;
  }
  if (error instanceof CommunityArchivedError) {
    return inviteMessages.archived;
  }
  if (error instanceof UnauthenticatedError) {
    return inviteMessages.signedOut;
  }
  return null;
}

export function invitePreviewMessage(preview: InvitePreview | null): string | null {
  if (!preview) {
    return inviteMessages.unavailable;
  }
  if (preview.status === "archived") {
    return inviteMessages.archived;
  }
  return preview.status === "active" ? null : inviteMessages.unavailable;
}
