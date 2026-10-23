import type { CommunityRole } from "@cohory/authz";
import type { CreatorExitAction, CreatorExitReason, CreatorMoment } from "@cohory/db/schema";

export type MomentResponse = "answered" | "dismissed" | "snoozed";

export interface CommunityStanding {
  readonly role: CommunityRole | null;
  readonly slug: string;
}

export interface CommunityOwner {
  readonly userId: string;
  readonly slug: string;
}

export interface PendingMoment {
  readonly communityId: string;
  readonly moment: CreatorMoment;
}

export interface MomentAnswer {
  readonly userId: string;
  readonly communityId: string;
  readonly moment: CreatorMoment;
  readonly status: MomentResponse;
  readonly score: number | null;
  readonly comment: string | null;
  readonly at: Date;
}

export interface ExitAnswer {
  readonly userId: string;
  readonly communityId: string | null;
  readonly action: CreatorExitAction;
  readonly reason: CreatorExitReason | null;
  readonly comment: string | null;
  readonly at: Date;
}

export interface CreatorFeedbackStore {
  standingIn(userId: string, communityId: string): Promise<CommunityStanding | null>;
  ownerOf(communityId: string): Promise<CommunityOwner | null>;
  optedOutAt(userId: string): Promise<Date | null>;
  setOptedOut(userId: string, at: Date | null): Promise<void>;
  lastMomentResponseAt(userId: string): Promise<Date | null>;
  oldestPendingMoment(userId: string, createdAfter: Date): Promise<PendingMoment | null>;
  insertPendingMoment(input: {
    readonly userId: string;
    readonly communityId: string;
    readonly moment: CreatorMoment;
    readonly at: Date;
  }): Promise<boolean>;
  respondToMoment(answer: MomentAnswer): Promise<boolean>;
  insertExit(answer: ExitAnswer): Promise<void>;
  removeCreatedBefore(cutoff: Date): Promise<number>;
}
