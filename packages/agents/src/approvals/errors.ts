export const approvalsErrorCodes = [
  "not_found",
  "limit_reached",
  "expired",
  "reauth_required",
  "agent_inactive",
  "download_unavailable",
] as const;

export type ApprovalsErrorCode = (typeof approvalsErrorCodes)[number];

export class ApprovalsError extends Error {
  constructor(readonly code: ApprovalsErrorCode) {
    super(code);
    this.name = "ApprovalsError";
  }
}
