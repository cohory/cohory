import type { DelegationEndReason } from "@cohory/db/schema";

import type { DelegationDenial } from "./access";
import type { LicenseTerms } from "./licenses";

export interface CourseAgentSettingsView {
  readonly courseId: string;
  readonly allowAgentAccess: boolean;
  readonly license: LicenseTerms;
  readonly updatedAt: Date | null;
}

export interface CourseAgentTerms {
  readonly allowAgentAccess: boolean;
  readonly license: LicenseTerms;
}

export type DelegationState =
  | { readonly kind: "active" }
  | { readonly kind: "paused"; readonly reason: DelegationDenial }
  | { readonly kind: "ended"; readonly reason: DelegationEndReason };

export interface DelegationView {
  readonly id: string;
  readonly courseId: string;
  readonly humanId: string;
  readonly agent: { readonly id: string; readonly name: string };
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly renewedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly state: DelegationState;
}

export interface AgentChoice {
  readonly id: string;
  readonly name: string;
}

export interface CourseAgentAccessView {
  readonly settings: CourseAgentSettingsView;
  readonly canManage: boolean;
  readonly canDelegate: boolean;
  readonly agents: readonly AgentChoice[];
  readonly delegations: readonly DelegationView[];
}

export type AgentCourseAccess =
  | { readonly kind: "not_agent" }
  | { readonly kind: "staff"; readonly agentId: string; readonly humanUserId: string }
  | {
      readonly kind: "delegated";
      readonly agentId: string;
      readonly humanUserId: string;
      readonly delegationId: string;
      readonly expiresAt: Date;
      readonly license: LicenseTerms;
    }
  | { readonly kind: "denied"; readonly reason: DelegationDenial };

export type AgentCourseGrant = Extract<AgentCourseAccess, { kind: "staff" | "delegated" }>;

export interface SubmissionView {
  readonly id: string;
  readonly courseId: string;
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
  readonly runId: string;
  readonly label: "self_reported";
  readonly agent: { readonly id: string; readonly name: string };
  readonly humanId: string;
  readonly createdAt: Date;
}

export interface SubmissionDetailView extends SubmissionView {
  readonly payload: unknown;
}

export interface SubmissionSummaryRow {
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
  readonly submissions: number;
  readonly agents: number;
  readonly members: number;
  readonly latestAt: Date;
}

export interface AgentLicenseListing {
  readonly courseId: string;
  readonly license: LicenseTerms;
}

export interface SweepResult {
  readonly ended: number;
  readonly noticesSent: number;
}
