import { approvalRisk, type ApprovalView } from "@cohory/agents/approvals";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";

export interface ApprovalDiffRow {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface ApprovalRow {
  readonly id: string;
  readonly state: ApprovalView["state"];
  readonly summary: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly agentActive: boolean;
  readonly riskLabel: string;
  readonly serious: boolean;
  readonly ownerName: string;
  readonly diff: readonly ApprovalDiffRow[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly expiresLabel: string;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly outcome: string;
  readonly executable: boolean;
}

function sentence(summary: string): string {
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function errorMessage(view: ApprovalView): string | null {
  const error = view.result?.error;
  if (error !== null && typeof error === "object" && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return null;
}

export function approvalOutcome(view: ApprovalView): string {
  const by = view.decidedBy?.name;
  switch (view.state) {
    case "pending":
      return "Waiting for a decision.";
    case "approved":
      return `Approved by ${by ?? "a person"}. Running now.`;
    case "executed":
      return view.download
        ? `Approved by ${by ?? "a person"}. The agent can download the file once within 24 hours.`
        : `Approved by ${by ?? "a person"} and done.`;
    case "failed": {
      const reason = errorMessage(view);
      return `Approved by ${by ?? "a person"}, but it could not run.${reason ? ` ${reason}` : ""}`;
    }
    case "rejected":
      return view.errorCode === "agent_inactive"
        ? (view.decisionNote ?? "Rejected because the agent was paused or revoked.")
        : `Rejected by ${by ?? "a person"}.${view.decisionNote ? ` Note: ${view.decisionNote}` : ""}`;
    case "expired":
      return "Nobody decided within 72 hours, so it expired.";
  }
}

export function toApprovalRow(view: ApprovalView, executable: boolean): ApprovalRow {
  const risk = approvalRisk(view.category);
  return {
    id: view.id,
    state: view.state,
    summary: sentence(view.summary),
    agentId: view.agent.id,
    agentName: view.agent.name,
    agentActive: view.agent.status === "active",
    riskLabel: risk.label,
    serious: risk.serious,
    ownerName: view.owner.name,
    diff: view.diff.map((line) => ({ ...line })),
    createdAt: view.createdAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
    expiresLabel: formatDateTimeWithZone(view.expiresAt, { timeZone: "UTC", style: "long" }),
    decidedByName: view.decidedBy?.name ?? null,
    decidedAt: view.decidedAt?.toISOString() ?? null,
    outcome: approvalOutcome(view),
    executable,
  };
}
