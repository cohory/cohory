import type { CompInvitationRecord, CompListRow, CompRecord } from "./store";

export type CompStatus = "active" | "expired" | "revoked";

export interface CompView {
  readonly id: string;
  readonly userId: string;
  readonly note: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly status: CompStatus;
}

export interface CompListItem extends CompView {
  readonly userName: string;
  readonly userEmail: string;
  readonly grantedByName: string | null;
}

export function compStatus(comp: CompRecord, now: Date): CompStatus {
  if (comp.endedAt) {
    return comp.endReason === "revoked" ? "revoked" : "expired";
  }
  return comp.expiresAt !== null && comp.expiresAt <= now ? "expired" : "active";
}

export function toCompView(comp: CompRecord, now: Date): CompView {
  return {
    id: comp.id,
    userId: comp.userId,
    note: comp.note,
    expiresAt: comp.expiresAt,
    createdAt: comp.createdAt,
    status: compStatus(comp, now),
  };
}

export function toCompListItem(row: CompListRow, now: Date): CompListItem {
  return {
    ...toCompView(row.comp, now),
    userName: row.userName,
    userEmail: row.userEmail,
    grantedByName: row.grantedByName,
  };
}

export interface CompInvitationView {
  readonly id: string;
  readonly email: string;
  readonly note: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

export interface CompInvitationListItem extends CompInvitationView {
  readonly grantedByName: string | null;
}

export interface CompOffer {
  readonly id: string;
  readonly expiresAt: Date | null;
}

export interface MyCompInvitations {
  readonly invitations: readonly CompOffer[];
  readonly waitingForVerification: boolean;
}

export type GrantCompResult =
  | { readonly kind: "granted"; readonly comp: CompView }
  | { readonly kind: "invited"; readonly invitation: CompInvitationView };

export function toCompInvitationView(invitation: CompInvitationRecord): CompInvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    note: invitation.note,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}
