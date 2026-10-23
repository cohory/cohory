import type { CompEndReason, compedMemberships, compInvitations } from "@cohory/db/schema";

export type CompRecord = typeof compedMemberships.$inferSelect;

export type CompInvitationRecord = typeof compInvitations.$inferSelect;

export interface NewComp {
  readonly userId: string;
  readonly grantedBy: string | null;
  readonly note: string | null;
  readonly expiresAt: Date | null;
}

export interface CompEnd {
  readonly reason: CompEndReason;
  readonly endedBy: string | null;
  readonly at: Date;
}

export interface CompListRow {
  readonly comp: CompRecord;
  readonly userName: string;
  readonly userEmail: string;
  readonly grantedByName: string | null;
}

export interface DueComp {
  readonly id: string;
  readonly communityId: string;
  readonly userId: string;
}

export interface CompAudit {
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string;
  readonly metadata: Record<string, unknown>;
}

export interface NewCompInvitation {
  readonly email: string;
  readonly grantedBy: string;
  readonly note: string | null;
  readonly expiresAt: Date | null;
}

export interface CompInvitationRow {
  readonly invitation: CompInvitationRecord;
  readonly grantedByName: string | null;
}

export interface CompInvitationStore {
  insert(invitation: NewCompInvitation): Promise<CompInvitationRecord | null>;
  findOpenByEmail(email: string): Promise<CompInvitationRecord | null>;
  findOpen(invitationId: string): Promise<CompInvitationRecord | null>;
  listOpen(limit: number): Promise<CompInvitationRow[]>;
  withdraw(
    invitationId: string,
    withdrawal: { readonly by: string; readonly at: Date },
  ): Promise<CompInvitationRecord | null>;
  accept(
    invitationId: string,
    acceptance: { readonly userId: string; readonly compId: string; readonly at: Date },
  ): Promise<CompInvitationRecord | null>;
}

export interface CompStore {
  readonly invitations: CompInvitationStore;
  findOpen(userId: string): Promise<CompRecord | null>;
  find(compId: string): Promise<CompRecord | null>;
  insert(comp: NewComp): Promise<CompRecord | null>;
  end(compId: string, end: CompEnd): Promise<CompRecord | null>;
  setExpiry(compId: string, expiresAt: Date, at: Date): Promise<CompRecord | null>;
  listOpen(limit: number): Promise<CompListRow[]>;
  findUserIdByEmail(email: string): Promise<string | null>;
  appendAudit(entry: CompAudit): Promise<void>;
}
