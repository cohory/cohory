import type {
  ApprovalDiffLine,
  ApprovalRecordedInput,
  ApprovalRequest,
  ApprovalState,
  AgentStatus,
} from "@cohory/db/schema";

export type { ApprovalDiffLine, ApprovalRecordedInput, ApprovalState };

export interface ApprovalPerson {
  readonly id: string;
  readonly name: string;
}

export interface ApprovalDownload {
  readonly available: boolean;
  readonly downloadedAt: Date | null;
  readonly availableUntil: Date;
}

export interface ApprovalView {
  readonly id: string;
  readonly communityId: string;
  readonly state: ApprovalState;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly category: string;
  readonly summary: string;
  readonly diff: readonly ApprovalDiffLine[];
  readonly agent: ApprovalPerson & { readonly status: AgentStatus };
  readonly owner: ApprovalPerson;
  readonly decidedBy: ApprovalPerson | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly executedAt: Date | null;
  readonly errorCode: string | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly download: ApprovalDownload | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ApprovalRow extends ApprovalRequest {
  readonly agentName: string;
  readonly agentStatus: AgentStatus;
  readonly ownerName: string | null;
  readonly decidedByName: string | null;
}

export const downloadWindowMs = 24 * 60 * 60 * 1000;

function downloadOf(row: ApprovalRow, now: Date): ApprovalDownload | null {
  if (row.result?.download !== true || !row.executedAt) {
    return null;
  }
  const availableUntil = new Date(row.executedAt.getTime() + downloadWindowMs);
  return {
    available: row.downloadedAt === null && now < availableUntil,
    downloadedAt: row.downloadedAt,
    availableUntil,
  };
}

export function toApprovalView(row: ApprovalRow, now: Date): ApprovalView {
  return {
    id: row.id,
    communityId: row.communityId,
    state: row.state,
    operationId: row.operationId,
    method: row.method,
    path: row.path,
    category: row.category,
    summary: row.summary,
    diff: row.diff,
    agent: { id: row.agentId, name: row.agentName, status: row.agentStatus },
    owner: { id: row.ownerId, name: row.ownerName ?? "Former member" },
    decidedBy: row.decidedBy
      ? { id: row.decidedBy, name: row.decidedByName ?? "Former member" }
      : null,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    executedAt: row.executedAt,
    errorCode: row.errorCode,
    result: row.result ?? null,
    download: downloadOf(row, now),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
