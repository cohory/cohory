import type {
  DelegationState,
  DelegationView,
  SubmissionDetailView,
  SubmissionSummaryRow,
} from "@cohory/entitlements";

export interface DelegationItem {
  readonly id: string;
  readonly courseId: string;
  readonly agentName: string;
  readonly status: string;
  readonly active: boolean;
  readonly live: boolean;
  readonly expiresAt: string;
}

export interface SubmissionItem {
  readonly id: string;
  readonly agentName: string;
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly payload: string;
}

export interface SummaryItem {
  readonly key: string;
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
  readonly submissions: number;
  readonly agents: number;
  readonly members: number;
}

const pausedLabels: Record<string, string> = {
  human_access_ended: "Paused: you no longer have access to this course",
  agent_inactive: "Paused: the agent is paused or revoked",
  agent_access_off: "Paused: the creator turned agent access off",
};

const endedLabels: Record<string, string> = {
  revoked: "Revoked",
  expired: "Expired",
  access_ended: "Ended: your access to the course ended",
  agent_inactive: "Ended: the agent was paused or revoked",
  agent_access_off: "Ended: the creator turned agent access off",
};

export function delegationStatus(state: DelegationState): string {
  switch (state.kind) {
    case "active":
      return "Active";
    case "paused":
      return pausedLabels[state.reason] ?? "Paused";
    case "ended":
      return endedLabels[state.reason] ?? "Ended";
  }
}

export function delegationItem(view: DelegationView): DelegationItem {
  return {
    id: view.id,
    courseId: view.courseId,
    agentName: view.agent.name,
    status: delegationStatus(view.state),
    active: view.state.kind === "active",
    live: view.revokedAt === null && view.state.kind !== "ended",
    expiresAt: view.expiresAt.toISOString(),
  };
}

const maxPreview = 400;

export function submissionItem(view: SubmissionDetailView): SubmissionItem {
  const text = JSON.stringify(view.payload) ?? "null";
  return {
    id: view.id,
    agentName: view.agent.name,
    lessonId: view.lessonId,
    taskId: view.taskId,
    version: view.version,
    runId: view.runId,
    createdAt: view.createdAt.toISOString(),
    payload: text.length > maxPreview ? `${text.slice(0, maxPreview - 1)}…` : text,
  };
}

export function summaryItem(row: SubmissionSummaryRow): SummaryItem {
  return {
    key: `${row.lessonId}:${row.taskId}:${row.version}`,
    lessonId: row.lessonId,
    taskId: row.taskId,
    version: row.version,
    submissions: row.submissions,
    agents: row.agents,
    members: row.members,
  };
}
