import { agentForbiddenActions, type PolicyAction } from "@cohory/authz";

import { routeScopes, type OperationId } from "../route-meta";

export const operationLabels: Partial<Record<OperationId, string>> = {
  createPost: "schedule a post",
  updateScheduledPost: "reschedule a post",
  publishScheduledPost: "publish a scheduled post now",
  cancelScheduledPost: "cancel a scheduled post",
  deletePost: "delete a post",
  deleteComment: "delete a comment",
  deleteCourse: "delete a course",
  publishCourse: "publish a course",
  unpublishCourse: "unpublish a course",
  publishAgentVersion: "publish an agent version of a course",
  deleteLessonAgentLayer: "remove the agent material of a lesson",
  deleteCourseModule: "delete a course module",
  deleteLesson: "delete a lesson",
  publishLesson: "publish a lesson",
  unpublishLesson: "unpublish a lesson",
  deleteCalendarEvent: "delete an event and all its dates",
  updateCommunitySettings: "change the community settings",
  updateCommunityAppearance: "change the community appearance",
  changeMemberRole: "change a member's role",
  removeMember: "remove a member",
  banMember: "ban a member",
  unbanMember: "lift a ban",
  banReportedAuthor: "ban the author of reported content",
  exportMembersCsv: "download the members list as a spreadsheet",
  exportAuditLogCsv: "download the audit log as a spreadsheet",
  transferOwnership: "transfer ownership of the community",
  archiveCommunity: "archive the community",
  unarchiveCommunity: "restore the community from the archive",
  deleteCommunity: "delete the community",
  grantComp: "give someone free access",
  revokeComp: "end someone's free access",
  withdrawCompInvitation: "withdraw an offer of free access",
  retryMigrationJob: "retry an import or export",
  startArchiveExport: "export the community archive",
  confirmArchiveImport: "import a community archive",
  confirmMembersCsv: "import members from a spreadsheet",
  updatePlatformBillingEmail: "change the billing email for platform fees",
  startPlatformBillingPaymentMethodSetup: "add a payment method for platform fees",
  connectStripe: "connect a Stripe account",
  refreshPaymentConnection: "refresh the payment connection",
  disconnectStripe: "disconnect payments",
  forceDisconnectStripe:
    "disconnect payments although some subscriptions still carry the platform fee",
  retryPaidMembersChange: "retry a change to paid members",
  keepPaymentAccount: "keep the previous owner's Stripe account for payments",
  upsertMembershipPlan: "change the membership plan and price",
  archiveMembershipPlan: "stop selling the membership plan",
  linkSubscribers: "link existing subscribers to members",
  createWebhookEndpoint: "add a webhook endpoint",
  updateWebhookEndpoint: "change a webhook endpoint",
  deleteWebhookEndpoint: "delete a webhook endpoint",
  rotateWebhookSecret: "replace a webhook signing secret",
  disableWebhookEndpoint: "turn off a webhook endpoint",
  enableWebhookEndpoint: "turn on a webhook endpoint",
  sendWebhookTestEvent: "send a webhook test event",
  resendWebhookDelivery: "resend a webhook delivery",
  resendFailedWebhookDeliveries: "resend failed webhook deliveries",
  createMembershipCheckout: "buy a membership",
};

export const downloadOperations: ReadonlySet<string> = new Set<OperationId>([
  "exportMembersCsv",
  "exportAuditLogCsv",
]);

export const unproposableOperations: ReadonlyMap<string, string> = new Map<OperationId, string>([
  [
    "connectOwnStripeKeys",
    "This needs secret keys, which an agent must never send. A person must connect payments in Cohory.",
  ],
]);

export const unsupportedExecutors: ReadonlySet<string> = new Set<OperationId>([
  "connectStripe",
  "startPlatformBillingPaymentMethodSetup",
]);

export function isOperationId(value: string): value is OperationId {
  return Object.hasOwn(routeScopes, value);
}

export function requiredActionFor(operationId: string): PolicyAction | null {
  return isOperationId(operationId) ? routeScopes[operationId].action : null;
}

export function isForbiddenForAgents(operationId: string): boolean {
  const action = requiredActionFor(operationId);
  return action !== null && agentForbiddenActions.has(action);
}

export function canExecute(operationId: string): boolean {
  return isOperationId(operationId) && !unsupportedExecutors.has(operationId);
}

export function labelFor(operationId: string): string {
  if (isOperationId(operationId)) {
    const label = operationLabels[operationId];
    if (label) {
      return label;
    }
  }
  return operationId.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).trim();
}
