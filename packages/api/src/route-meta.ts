import type { PolicyAction, Scope } from "@cohory/authz";

import { mcpTools } from "./mcp-tools";

export interface CohoryRouteMeta {
  readonly scope: Scope | null;
  readonly action: PolicyAction | null;
}

function token(scope: Scope, action: PolicyAction): CohoryRouteMeta {
  return { scope, action };
}

function session(action: PolicyAction | null): CohoryRouteMeta {
  return { scope: null, action };
}

export const routeScopes = {
  getHealth: session(null),
  getLiveness: session(null),

  createCommunity: session("community.create"),
  listMyCommunities: session("membership.read_own"),
  getCommunity: token("community:read", "community.read"),
  joinCommunity: session("membership.join"),
  leaveCommunity: session("membership.leave"),
  getMyMembership: token("community:read", "membership.read_own"),
  getCommunityAppearance: token("community:read", "community.read"),
  redeemInvite: session("membership.join"),

  listPosts: token("posts:read", "post.read"),
  createPost: token("posts:write", "post.create"),
  getPost: token("posts:read", "post.read"),
  updatePost: token("posts:write", "post.edit"),
  deletePost: token("posts:write", "post.delete"),
  pinPost: token("posts:write", "post.pin"),
  unpinPost: token("posts:write", "post.pin"),
  likePost: token("posts:write", "post.like"),
  unlikePost: token("posts:write", "post.like"),
  followPost: token("posts:write", "post.read"),
  unfollowPost: token("posts:write", "post.read"),
  getMemberEmailStatus: session("post.email_all"),
  emailPostToMembers: session("post.email_all"),
  uploadPostImage: token("posts:write", "post.create"),
  listPostDrafts: token("posts:read", "post.create"),
  publishPostDraft: session("post.create"),
  discardPostDraft: session("post.create"),
  listComments: token("comments:read", "comment.read"),
  createComment: token("comments:write", "comment.create"),
  updateComment: token("comments:write", "comment.edit"),
  deleteComment: token("comments:write", "comment.delete"),
  likeComment: token("comments:write", "comment.like"),
  unlikeComment: token("comments:write", "comment.like"),
  searchCommunity: token("posts:read", "post.read"),
  reportPost: token("posts:write", "report.create"),
  reportComment: token("comments:write", "report.create"),

  listReviews: token("community:read", "review.read"),
  getReviewSummary: token("community:read", "review.read"),
  createReview: session("review.create"),
  updateReview: session("review.edit"),
  deleteReview: session("review.delete"),
  replyToReview: session("review.reply"),
  updateReviewReply: session("review.reply"),
  deleteReviewReply: session("review.reply"),
  reportReview: session("review.report"),
  hideReview: session("review.hide"),
  listReviewReports: session("report.review"),
  dismissReviewReports: session("report.review"),

  listNotifications: session("notification.read"),
  getNotificationUnreadCount: session("notification.read"),
  markNotificationsRead: session("notification.mark_read"),
  markAllNotificationsRead: session("notification.mark_read"),
  getNotificationPreferences: session("account.update_own"),
  updateNotificationPreferences: session("account.update_own"),
  unsubscribeFromNotificationEmail: session(null),

  searchMembers: token("members:read", "membership.list"),
  updateMyMemberProfile: session("membership.update_own_profile"),
  getMemberProfile: token("members:read", "membership.read_profile"),
  getLeaderboard: token("members:read", "leaderboard.read"),
  updateMe: session("account.update_own"),

  listCourses: token("courses:read", "course.read"),
  createCourse: token("courses:write", "course.create"),
  getCourse: token("courses:read", "course.read"),
  updateCourse: token("courses:write", "course.update"),
  deleteCourse: token("courses:write", "course.delete"),
  publishCourse: token("courses:write", "course.publish"),
  unpublishCourse: token("courses:write", "course.publish"),
  reorderCourseModules: token("courses:write", "course.reorder"),
  createCourseModule: token("courses:write", "course.update"),
  updateCourseModule: token("courses:write", "course.update"),
  deleteCourseModule: token("courses:write", "course.delete"),
  reorderLessons: token("courses:write", "lesson.reorder"),
  createLesson: token("courses:write", "lesson.create"),
  getLesson: token("courses:read", "lesson.read"),
  updateLesson: token("courses:write", "lesson.update"),
  deleteLesson: token("courses:write", "lesson.delete"),
  publishLesson: token("courses:write", "lesson.publish"),
  unpublishLesson: token("courses:write", "lesson.publish"),
  completeLesson: token("courses:read", "lesson.update_progress"),
  uncompleteLesson: token("courses:read", "lesson.update_progress"),
  recordLessonView: token("courses:read", "lesson.update_progress"),
  getContinueLearning: token("courses:read", "course.read"),
  uploadLessonAttachment: token("courses:write", "lesson.update"),
  getCourseAgentAuthoring: token("courses:read", "course.read_drafts"),
  getLessonAgentLayer: token("courses:read", "course.read_drafts"),
  saveLessonAgentLayer: token("courses:write", "course.update"),
  deleteLessonAgentLayer: token("courses:write", "lesson.delete"),
  draftLessonAgentLayer: token("courses:read", "course.read_drafts"),
  uploadAgentFile: token("courses:write", "course.update"),
  publishAgentVersion: token("courses:write", "course.publish_agent_version"),
  listAgentVersions: token("courses:read", "course.read_drafts"),
  exportAgentVersion: token("courses:read", "course.read_drafts"),
  getAgentMaterial: token("courses:read", "course.read"),
  getAgentTask: token("courses:read", "lesson.read"),
  getAgentMaterialFile: token("courses:read", "lesson.read"),

  listCalendarOccurrences: token("events:read", "event.read"),
  listMyUpcomingOccurrences: token("events:read", "event.read"),
  createCalendarEvent: token("events:write", "event.create"),
  getCalendarEvent: token("events:read", "event.read"),
  updateCalendarEvent: token("events:write", "event.update"),
  deleteCalendarEvent: token("events:write", "event.delete"),
  downloadCalendarEventIcs: token("events:read", "event.read"),
  getCalendarOccurrence: token("events:read", "event.read"),
  listCalendarOccurrenceRsvps: token("events:read", "event.read_rsvps"),
  cancelCalendarOccurrence: token("events:write", "event.cancel_occurrence"),
  restoreCalendarOccurrence: token("events:write", "event.cancel_occurrence"),
  rsvpCalendarOccurrence: token("events:write", "event.rsvp"),
  downloadCalendarOccurrenceIcs: token("events:read", "event.read"),

  getManageOverview: token("settings:read", "settings.read"),
  getManageUsage: token("settings:read", "settings.read"),
  getCommunitySettings: token("settings:read", "settings.read"),
  updateCommunitySettings: session("settings.update"),
  updateCommunityAppearance: session("appearance.update"),
  uploadCommunityLogo: session("appearance.update"),
  uploadCommunityCover: session("appearance.update"),
  addCommunityGalleryImage: session("appearance.update"),
  addCommunityGalleryVideo: session("appearance.update"),
  reorderCommunityGallery: session("appearance.update"),
  updateCommunityGalleryItem: session("appearance.update"),
  removeCommunityGalleryItem: session("appearance.update"),
  listManagePeople: token("members:read", "membership.manage"),
  changeMemberRole: token("members:moderate", "membership.change_role"),
  removeMember: token("members:moderate", "membership.remove"),
  banMember: token("members:moderate", "membership.ban"),
  unbanMember: token("members:moderate", "membership.ban"),
  listInviteLinks: session("invite.manage"),
  createInviteLink: session("invite.manage"),
  revokeInviteLink: session("invite.manage"),
  exportMembersCsv: token("members:export", "export.members"),
  transferOwnership: session("community.transfer_ownership"),
  archiveCommunity: session("community.archive"),
  unarchiveCommunity: session("community.archive"),
  deleteCommunity: session("community.delete"),

  listReports: token("members:moderate", "report.review"),
  dismissReports: token("members:moderate", "report.review"),
  banReportedAuthor: token("members:moderate", "membership.ban"),
  listAuditLog: token("settings:read", "audit_log.read"),
  exportAuditLogCsv: session("audit_log.export"),
  listJoinRequests: token("members:moderate", "membership.approve"),
  approveJoinRequest: token("members:moderate", "membership.approve"),
  declineJoinRequest: token("members:moderate", "membership.approve"),

  listComps: token("payments:read", "payment.read"),
  grantComp: session("membership.grant_comp"),
  revokeComp: session("membership.grant_comp"),
  listCompInvitations: token("payments:read", "payment.read"),
  withdrawCompInvitation: session("membership.grant_comp"),
  listMyCompOffers: session("payment.read_own"),
  acceptCompOffer: session("membership.join"),

  listMigrationJobs: session("migration.export"),
  getMigrationJob: session("migration.export"),
  retryMigrationJob: session("migration.import"),
  startArchiveExport: session("migration.export"),
  downloadArchiveExport: session("migration.export"),
  deleteArchiveExport: session("migration.export"),
  discardMigrationPreview: session("migration.import"),
  sendImportEmails: session("migration.import"),
  previewImportEmail: session("migration.import"),
  sendTestImportEmail: session("migration.import"),
  resendImportEmail: session("migration.import"),
  downloadMigrationReport: session("migration.export"),
  uploadArchiveImport: session("migration.import"),
  confirmArchiveImport: session("migration.import"),
  previewMembersCsv: session("migration.import_members"),
  confirmMembersCsv: session("migration.import_members"),
  listImporters: session("migration.import"),
  uploadPlatformImport: session("migration.import"),

  getPlatformFees: token("payments:read", "payment.read"),
  updatePlatformBillingEmail: session("payment.connect"),
  startPlatformBillingPaymentMethodSetup: session("payment.connect"),
  getPaymentsOverview: token("payments:read", "payment.read"),
  connectStripe: session("payment.connect"),
  connectOwnStripeKeys: session("payment.connect"),
  refreshPaymentConnection: session("payment.connect"),
  disconnectStripe: session("payment.connect"),
  forceDisconnectStripe: session("payment.connect"),
  retryPaidMembersChange: session("payment.connect"),
  getPaymentOwnershipReview: session("payment.connect"),
  keepPaymentAccount: session("payment.connect"),
  getMembershipPlan: token("payments:read", "payment.read"),
  upsertMembershipPlan: session("payment.edit_plan"),
  archiveMembershipPlan: session("payment.edit_plan"),
  createMembershipCheckout: session("payment.purchase"),
  createBillingPortalSession: session("payment.read_own"),
  getMyPaidMembership: session("payment.read_own"),
  listSubscriptions: token("payments:read", "payment.read"),
  getPaymentsLedgerSummary: token("payments:read", "payment.read"),
  getPaidMembersSummary: session("payment.read"),
  discoverSubscribers: token("payments:read", "payment.read"),
  listSubscriptionLinks: token("payments:read", "payment.read"),
  linkSubscribers: session("payment.link_subscriptions"),

  listScheduledPosts: token("posts:read", "post.create"),
  updateScheduledPost: token("posts:write", "post.edit"),
  cancelScheduledPost: token("posts:write", "post.delete"),
  publishScheduledPost: token("posts:write", "post.edit"),

  listWebhookEndpoints: token("webhooks:read", "webhook.manage"),
  getWebhookEndpoint: token("webhooks:read", "webhook.manage"),
  listWebhookDeliveries: token("webhooks:read", "webhook.manage"),
  getWebhookDelivery: token("webhooks:read", "webhook.manage"),
  resendWebhookDelivery: token("webhooks:write", "webhook.manage"),
  resendFailedWebhookDeliveries: token("webhooks:write", "webhook.manage"),
  createWebhookEndpoint: token("webhooks:write", "webhook.manage"),
  updateWebhookEndpoint: token("webhooks:write", "webhook.manage"),
  deleteWebhookEndpoint: token("webhooks:write", "webhook.manage"),
  rotateWebhookSecret: token("webhooks:write", "webhook.manage"),
  disableWebhookEndpoint: token("webhooks:write", "webhook.manage"),
  enableWebhookEndpoint: token("webhooks:write", "webhook.manage"),
  sendWebhookTestEvent: token("webhooks:write", "webhook.manage"),

  listMyApiTokens: session("api_token.create_own"),
  createMyApiToken: session("api_token.create_own"),
  revokeMyApiToken: session("api_token.create_own"),
  listAgents: session("agent.read"),
  createAgent: session("agent.create"),
  updateAgent: session("agent.manage"),
  revokeAgent: session("agent.manage"),
  createAgentToken: session("agent.manage"),
  revokeAgentToken: session("agent.manage"),

  listApprovalRequests: token("proposals:write", "approval.read_own"),
  getApprovalRequest: token("proposals:write", "approval.read_own"),
  downloadApprovalResult: token("proposals:write", "approval.read_own"),
  listManageApprovals: session("approval.read"),
  approveApprovalRequest: session("approval.decide"),
  rejectApprovalRequest: session("approval.decide"),

  getCourseAgentAccess: token("courses:read", "course.read"),
  updateCourseAgentAccess: session("course.manage_agent_access"),
  listMyDelegations: session("delegation.manage"),
  createDelegation: session("delegation.create"),
  renewDelegation: session("delegation.manage"),
  revokeDelegation: session("delegation.manage"),
  submitAgentResult: token("courses:read", "submission.create"),
  listAgentSubmissions: token("courses:read", "submission.read_own"),
  getAgentSubmissionSummary: token("courses:write", "submission.read_summary"),
  listPurchaseRequests: session("approval.read_own"),
  approvePurchaseRequest: session("approval.read_own"),
  rejectPurchaseRequest: session("approval.read_own"),

  listMyAgentCourses: token("courses:read", "course.read"),
  getAgentMaterialFileContent: token("courses:read", "lesson.read"),
  getAgentSkillExport: token("courses:read", "course.read"),
  downloadAgentFile: { scope: "courses:read", action: null },
} as const satisfies Record<string, CohoryRouteMeta>;

export type OperationId = keyof typeof routeScopes;

export const cohoryExtension = "x-cohory";

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpToolMeta {
  readonly tool: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: McpToolAnnotations;
  readonly userContent: boolean;
  readonly contentSource?: "course_material";
  readonly agentProposal?: boolean;
  readonly omit?: readonly string[];
  readonly require?: readonly string[];
}

export interface CohoryRouteExtension extends CohoryRouteMeta {
  readonly operationId: OperationId;
  readonly mcp?: readonly McpToolMeta[];
}

export function routeMeta(operationId: OperationId): CohoryRouteExtension {
  const tools = mcpTools[operationId];
  return { operationId, ...routeScopes[operationId], ...(tools ? { mcp: tools } : {}) };
}
