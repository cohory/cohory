export { createLogMailer, type LogMailer } from "./drivers/log";
export { communityEmailBrand, communityImageUrl, emailLogoUrl } from "./community-brand";
export { emailConfigProblem, parseEmailEnv, type EmailEnv } from "./env";
export {
  createDbEmailLog,
  emailErrorCode,
  hashEmailAddress,
  withEmailLog,
  type EmailLog,
  type EmailLogEntry,
} from "./log";
export {
  maskEmailAddress,
  operatorActor,
  recordSuppressionChange,
  type SuppressionChange,
} from "./audit";
export { createMailer, getEmailLog, getMailer, getSuppressionList, sendEmail } from "./mailer";
export {
  createDbSuppressionList,
  createMemorySuppressionList,
  isPermanentRecipientFailure,
  isSecurityEmail,
  securityEmailTemplates,
  withSuppression,
  type SuppressionEntry,
  type SuppressionList,
  type SuppressionLookup,
} from "./suppression";
export { emailGreeting, emailSafeName, flattenEmailText } from "./names";
export { emailTemplateIds, type EmailTemplateId } from "./templates/ids";
export { emailMessageSchema, type EmailContent, type EmailMessage, type Mailer } from "./message";
export {
  renderLayout,
  type CommunityBrandInput,
  type EmailBlock,
  type EmailBrand,
  type EmailFooter,
  type EmailLink,
  type LayoutInput,
} from "./templates/layout";
export { compInvitationEmail } from "./templates/comp-invitation";
export { creatorsInviteEmail, type CreatorsInviteInput } from "./templates/creators-invite";
export {
  contactMessageEmail,
  contactMessageSubject,
  type ContactAccountBlock,
  type ContactMessageInput,
} from "./templates/contact";
export {
  earlyAccessRequestEmail,
  earlyAccessRequestSubject,
  type EarlyAccessRequestInput,
} from "./templates/early-access";
export { emailVerificationEmail } from "./templates/email-verification";
export { existingAccountSignUpEmail } from "./templates/existing-account-sign-up";
export { eventReminderEmail } from "./templates/event-reminder";
export { rsvpConfirmationEmail } from "./templates/rsvp-confirmation";
export { eventCanceledEmail, type EventCanceledReason } from "./templates/event-canceled";
export { eventDatesRemovedEmail } from "./templates/event-dates-removed";
export { eventUpdatedEmail } from "./templates/event-updated";
export { notificationDigestEmail, notificationEmail } from "./templates/notification";
export {
  feeClearRequiredEmail,
  paidMembershipChangedEmail,
  paidMembershipNoticeText,
  type FeeClearRequiredInput,
  type PaidMembershipChange,
  type PaidMembershipChangedInput,
} from "./templates/paid-membership";
export {
  memberPaymentFailedEmail,
  memberPaymentFailedNoticeText,
  type MemberPaymentFailedInput,
} from "./templates/member-payment-failed";
export {
  ownershipTransferredEmail,
  type OwnershipTransferredInput,
} from "./templates/ownership-transferred";
export { passwordResetEmail } from "./templates/password-reset";
export {
  paymentDisputedEmail,
  paymentDisputedNoticeText,
  type PaymentDisputedInput,
} from "./templates/payment-disputed";
export {
  duplicateRefundedEmail,
  type DuplicateRefundedInput,
} from "./templates/duplicate-refunded";
export {
  communityMovedEmail,
  memberAddedEmail,
  emailSafeNote,
  memberInvitedEmail,
  migrationNoteMaxLength,
  type CommunityMove,
  type FirstContact,
  type FirstContactOrigin,
} from "./templates/migration";
export {
  createOptOutLinker,
  createOptOutToken,
  optOutSecretFromEnv,
  verifyOptOutToken,
  type OptOutClaim,
  type OptOutLinker,
  type OptOutLinks,
} from "./opt-out";
export {
  migrationExportReadyEmail,
  migrationImportFailedEmail,
  migrationImportFinishedEmail,
  type MigrationImportFinishedInput,
} from "./templates/migration-import-finished";
export { movingOfferEmail } from "./templates/moving-offer";
export { subscriptionMovedEmail } from "./templates/subscription-moved";
export { testEmail } from "./templates/test-email";
export { tokenExpiringEmail, type TokenExpiringInput } from "./templates/token-expiring";
export { renewalReminderEmail, type RenewalReminderInput } from "./templates/renewal-reminder";
export { webhookEndpointDisabledEmail } from "./templates/webhook-disabled";
export {
  weeklyDigestEmail,
  type WeeklyDigestCommunity,
  type WeeklyDigestEvent,
  type WeeklyDigestInput,
  type WeeklyDigestPost,
} from "./templates/weekly-digest";
export { welcomeEmail, type WelcomeInput } from "./templates/welcome";
export {
  memberAnnouncementEmail,
  type MemberAnnouncementInput,
} from "./templates/member-announcement";
export {
  formatMinorAmount,
  platformBillingPausedEmail,
  platformInvoicePaymentFailedEmail,
} from "./templates/platform-billing";
export {
  emailWebhookMaxBytes,
  emailWebhookSecretFromEnv,
  emailWebhookSignatureHeader,
  handleEmailWebhook,
  signEmailWebhook,
  type EmailWebhookResult,
} from "./webhook";
export {
  createEmailOutbox,
  deliverQueuedEmail,
  directEmailOutbox,
  EmailSendError,
  emailSendJob,
  emailSendQueueOptions,
  ensureEmailSendQueue,
  queuedEmailSchema,
  renderQueuedEmail,
  type EmailJobSender,
  type EmailOutbox,
  type QueuedEmail,
} from "./queue";
export { getEmailOutbox } from "./queue-pg-boss";
export {
  changeEmailConfirmationEmail,
  changeEmailVerificationEmail,
} from "./templates/change-email";
export { magicLinkEmail } from "./templates/magic-link";
export {
  contentReportEmail,
  contentReportReceivedEmail,
  dataExportReadyEmail,
  type ContentReportInput,
  type DataExportReadyInput,
} from "./templates/legal";
export { passwordChangedEmail } from "./templates/password-changed";
export { passwordRemovedEmail } from "./templates/password-removed";
