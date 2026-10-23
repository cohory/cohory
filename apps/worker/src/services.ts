import { getAgentsService, getTokenExpirySweep } from "@cohory/agents";
import { getOAuthClientPrune } from "@cohory/agents/oauth";
import { getApprovalsService } from "@cohory/agents/approvals";
import { attendedOccurrencesBetween } from "@cohory/calendar";
import { getLegalConfig } from "@cohory/config/legal";
import { parseAppUrl, parseEdition } from "@cohory/config/platform";
import {
  collectDefaultAgentFileGarbage,
  countPublishedCourses,
  createDefaultCoursesService,
  lessonCompletionsBetween,
} from "@cohory/courses";
import { getDb, parseCommunityId } from "@cohory/db";
import {
  backfillMemberLastSeen,
  getManageService,
  purgeDeletedCommunitiesNow,
} from "@cohory/communities";
import { createEntitlementsService } from "@cohory/entitlements";
import { getGamificationService } from "@cohory/gamification";
import {
  getAgentAccessNotifier,
  getJoinNotifier,
  getMembershipNotifier,
  getNotificationsFanout,
  getPaidMembershipNotifier,
  type JoinNotifier,
  type SendWelcomeEmail,
  type MembershipNotifier,
  type PaidMembershipNotifier,
  type NotificationsFanout,
} from "@cohory/notifications";
import {
  expireMigrationFiles,
  getMigrationRuntime,
  runExportJob,
  runImportFinishedJob,
  runImportJob,
  runMembersImportJob,
} from "@cohory/migration";
import {
  createCreatorFeedbackService,
  createPostgresCreatorFeedbackStore,
} from "@cohory/notifications/creator-feedback";
import {
  countActivatedSubscriptions,
  getPaymentsService,
  rotateStoredPaymentSecrets,
} from "@cohory/payments";
import { emailConfigProblem, getEmailOutbox, sendEmail } from "@cohory/email";
import { countPublishedPosts, createDefaultPostsService } from "@cohory/posts";
import { getMemberEmailJob, type SendMemberEmail } from "@cohory/posts/member-email-job";
import { relayPendingOutbox } from "@cohory/events";
import { getPlatformBillingService } from "@cohory/payments/billing";
import { getWebhookJobs, rotateStoredWebhookSecrets, type WebhookJobs } from "@cohory/webhooks";
import { deliverQueuedEmail, getMailer } from "@cohory/email";

import { type ExpireApprovals } from "./jobs/approvals-expiry";
import { type SweepDelegations } from "./jobs/delegations-sweep";
import { type NoticeExpiringTokens } from "./jobs/tokens-expiry";
import { type PruneOAuthClients } from "./jobs/oauth-clients-prune";
import { defaultAccountPurge, type PurgeDueAccounts } from "./jobs/account-purge";
import {
  defaultCalendarJobs,
  type ExtendSeries,
  type NotifyTimeChange,
  type SendCalendarNotice,
  type SendDueReminders,
} from "./jobs/calendar";
import { awardLearningPoints, type AwardLearningPoints } from "./jobs/gamification-learning";
import { type RecordPoints } from "./jobs/gamification-points";
import {
  isFirstMoment,
  type RecordMoment,
  type RemoveExpiredFeedback,
} from "./jobs/feedback-moments";
import { type GenerateInvoices, type ReconcileBilling } from "./jobs/billing";
import { type CollectAgentFileGarbage } from "./jobs/agent-files-gc";
import { defaultInviteCreator, type InviteCreator } from "./jobs/communities-creators-invite";
import { type PurgeDeletedCommunities } from "./jobs/communities-purge";
import { type SendQueuedEmail } from "./jobs/email-send";
import { type ReencryptSecrets } from "./jobs/secrets-reencrypt";
import { type PublishScheduledDeps } from "./jobs/posts-scheduled";
import { type BackfillLastSeen } from "./jobs/members-last-seen";
import {
  defaultNotificationEmailJobs,
  type SendNotificationEmails,
} from "./jobs/notifications-email";
import { defaultWelcomeEmailJob } from "./jobs/notifications-welcome";
import { defaultWeeklyDigestJob, type SendWeeklyDigests } from "./jobs/notifications-weekly-digest";
import { defaultOutboxRelayDeps, type OutboxRelayDeps } from "./jobs/outbox-relay";
import { type EndClosedBillingAccess } from "./jobs/payments-closed-billing";
import { type ExpireComps } from "./jobs/payments-comps-expiry";
import { type SweepSubscriberMoves } from "./jobs/payments-moves-retention";
import {
  type PrepareRenewalReminder,
  type QueueRenewalReminders,
  type SendRenewalEmail,
} from "./jobs/payments-renewal-reminders";
import { type ExpireHolds } from "./jobs/payments-holds-expiry";
import { type RemoveApplicationFees } from "./jobs/payments-fee-removal";
import { type CompleteCommunityDeletion, type RunExitRun } from "./jobs/payments-exit-run";
import { type EndBillingForRemovedMember } from "./jobs/payments-member-billing";
import {
  type ReconcileConnection,
  type ScheduleConnectionReconciles,
} from "./jobs/payments-reconcile";
import {
  type ProcessBillingWebhookEvent,
  type ProcessWebhookEvent,
  type SweepWebhookEvents,
} from "./jobs/payments-webhooks";
import {
  MIGRATION_EXPORT,
  MIGRATION_IMPORT,
  MIGRATION_IMPORT_FINISHED,
  MIGRATION_MEMBERS_IMPORT,
  type ExpireMigrationFiles,
  type RunMigrationJob,
} from "./jobs/migration";
import { type WebhookJobsDeps } from "./jobs/webhooks";
import type { Logger } from "./logger";

export interface JobDeps {
  readonly fanOutNotifications: NotificationsFanout;
  readonly notifyMembership: MembershipNotifier;
  readonly notifyJoins: JoinNotifier;
  readonly sendWelcomeEmail: SendWelcomeEmail;
  readonly inviteCreator: InviteCreator;
  readonly sendMemberEmail: SendMemberEmail;
  readonly notifyPaidMembership: PaidMembershipNotifier;
  readonly recordPoints: RecordPoints;
  readonly recordMoment: RecordMoment;
  readonly removeExpiredFeedback: RemoveExpiredFeedback;
  readonly awardLearningPoints: AwardLearningPoints;
  readonly sendDueReminders: SendDueReminders;
  readonly extendSeries: ExtendSeries;
  readonly notifyTimeChange: NotifyTimeChange;
  readonly sendCalendarNotice: SendCalendarNotice;
  readonly outbox: OutboxRelayDeps;
  readonly scheduledPosts: PublishScheduledDeps;
  readonly removeApplicationFees: RemoveApplicationFees;
  readonly runExitRun: RunExitRun;
  readonly completeCommunityDeletion: CompleteCommunityDeletion;
  readonly purgeDeletedCommunities: PurgeDeletedCommunities;
  readonly endBillingForRemovedMember: EndBillingForRemovedMember;
  readonly processPaymentWebhook: ProcessWebhookEvent;
  readonly processBillingWebhook: ProcessBillingWebhookEvent;
  readonly sweepWebhookEvents: SweepWebhookEvents;
  readonly scheduleConnectionReconciles: ScheduleConnectionReconciles;
  readonly reconcileConnection: ReconcileConnection;
  readonly sendNotificationEmails: SendNotificationEmails;
  readonly sendNotificationDigests: SendNotificationEmails;
  readonly sendWeeklyDigests: SendWeeklyDigests;
  readonly purgeDueAccounts: PurgeDueAccounts;
  readonly expireComps: ExpireComps;
  readonly sweepSubscriberMoves: SweepSubscriberMoves;
  readonly expireHolds: ExpireHolds;
  readonly queueRenewalReminders: QueueRenewalReminders;
  readonly prepareRenewalReminder: PrepareRenewalReminder;
  readonly sendRenewalEmail: SendRenewalEmail;
  readonly appUrl: string;
  readonly endClosedBillingAccess: EndClosedBillingAccess;
  readonly runMigration: RunMigrationJob;
  readonly expireMigrationFiles: ExpireMigrationFiles;
  readonly generateInvoices: GenerateInvoices;
  readonly reconcileBilling: ReconcileBilling;
  readonly backfillLastSeen: BackfillLastSeen;
  readonly webhooks: WebhookJobsDeps;
  readonly expireApprovals: ExpireApprovals;
  readonly sweepDelegations: SweepDelegations;
  readonly noticeExpiringTokens: NoticeExpiringTokens;
  readonly pruneOAuthClients: PruneOAuthClients;
  readonly reencryptSecrets: ReencryptSecrets;
  readonly collectAgentFileGarbage: CollectAgentFileGarbage;
  readonly sendQueuedEmail: SendQueuedEmail;
}

function lazyWebhookJobs(appUrl: string, logger: Logger): WebhookJobsDeps {
  let jobs: WebhookJobs | undefined;
  const get = () => {
    jobs ??= getWebhookJobs(appUrl, (line) => logger.warn(line, "webhooks"));
    return jobs;
  };
  return {
    fanout: (payload) => get().fanout(payload),
    deliver: (deliveryId) => get().deliver(deliveryId),
    sweep: () => get().sweep(),
  };
}

const migrationRunners = {
  [MIGRATION_EXPORT]: runExportJob,
  [MIGRATION_IMPORT]: runImportJob,
  [MIGRATION_MEMBERS_IMPORT]: runMembersImportJob,
  [MIGRATION_IMPORT_FINISHED]: runImportFinishedJob,
} as const;

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

// The worker builds its own instances; it relays post events through the outbox, not after commit.
const posts = once(() => createDefaultPostsService());

const entitlements = once(() =>
  createEntitlementsService({
    db: getDb(),
    agents: {
      find: (communityId, agentId) => getAgentsService().findAgent(communityId, agentId),
      list: (communityId, filter) => getAgentsService().agentSummaries(communityId, filter),
    },
    membershipAccess: (communityId, userId) =>
      getPaymentsService().getMembershipAccess(communityId, userId),
    notify: getAgentAccessNotifier(),
  }),
);

const courses = once(() => createDefaultCoursesService({ agentAccess: entitlements() }));

const creatorFeedback = once(() => {
  const db = getDb();
  const contactEmail = getLegalConfig().contactEmail;
  return createCreatorFeedbackService({
    store: createPostgresCreatorFeedbackStore(db),
    outbox: getEmailOutbox(),
    contactEmail: contactEmail && emailConfigProblem() === null ? contactEmail : null,
    edition: parseEdition(),
    instanceUrl: parseAppUrl(),
    isFirstMoment: (communityId, moment) =>
      isFirstMoment(
        {
          posts: (id) => countPublishedPosts(db, parseCommunityId(id)),
          courses: (id) => countPublishedCourses(db, parseCommunityId(id)),
          paidMembers: (id) => countActivatedSubscriptions(db, parseCommunityId(id)),
        },
        communityId,
        moment,
      ),
  });
});

export function defaultJobDeps(appUrl: string, logger: Logger): JobDeps {
  return {
    fanOutNotifications: (events) => getNotificationsFanout()(events),
    notifyMembership: (events) => getMembershipNotifier(appUrl)(events),
    notifyJoins: (events) => getJoinNotifier()(events),
    sendWelcomeEmail: (input) => defaultWelcomeEmailJob(appUrl, courses())(input),
    inviteCreator: defaultInviteCreator(appUrl),
    sendMemberEmail: (input, options) =>
      getMemberEmailJob(appUrl, (error) =>
        logger.warn(
          { name: error instanceof Error ? error.name : "unknown" },
          "member email failed",
        ),
      )(input, options),
    notifyPaidMembership: (events) => getPaidMembershipNotifier(appUrl)(events),
    recordPoints: (events) => getGamificationService().recordPostEvents(events),
    recordMoment: (moment) => creatorFeedback().recordMoment(moment),
    removeExpiredFeedback: () => creatorFeedback().removeExpired(),
    awardLearningPoints: () =>
      awardLearningPoints({
        communities: () => getGamificationService().learningPointsCommunities(),
        lessonCompletions: (id, after, until) =>
          lessonCompletionsBetween(getDb(), parseCommunityId(id), after, until),
        attendance: (id, after, until) =>
          attendedOccurrencesBetween(getDb(), parseCommunityId(id), after, until),
        record: (id, activities) =>
          getGamificationService().recordLearningActivities(id, activities),
        onCommunityError: (communityId, error) =>
          logger.warn(
            { communityId, name: error instanceof Error ? error.name : "unknown" },
            "learning points failed for a community",
          ),
      }),
    sendDueReminders: () => defaultCalendarJobs(appUrl, logger).sendDueReminders(),
    extendSeries: () => defaultCalendarJobs(appUrl, logger).extendSeries(),
    notifyTimeChange: (payload) => defaultCalendarJobs(appUrl, logger).notifyTimeChange(payload),
    sendCalendarNotice: (notice) => defaultCalendarJobs(appUrl, logger).sendNotice(notice),
    outbox: defaultOutboxRelayDeps,
    scheduledPosts: {
      publishDue: () => posts().publishDuePosts(),
      relay: (ids) => relayPendingOutbox({ ids }),
    },
    removeApplicationFees: (connectionId) =>
      getPaymentsService().removeApplicationFees(connectionId),
    runExitRun: (payload) => getPaymentsService().runExitRun(payload),
    completeCommunityDeletion: (communityId) =>
      getManageService().completeCommunityDeletion(communityId),
    purgeDeletedCommunities: () => purgeDeletedCommunitiesNow(),
    endBillingForRemovedMember: (payload) =>
      getPaymentsService().endBillingForRemovedMember(payload),
    processPaymentWebhook: (payload) => getPaymentsService().processWebhookEvent(payload),
    processBillingWebhook: (payload) =>
      getPlatformBillingService().processBillingWebhookEvent(payload),
    sweepWebhookEvents: () => getPaymentsService().sweepWebhookEvents(),
    scheduleConnectionReconciles: () => getPaymentsService().scheduleConnectionReconciles(),
    reconcileConnection: (connectionId) => getPaymentsService().reconcileConnection(connectionId),
    sendNotificationEmails: () => defaultNotificationEmailJobs(appUrl, logger).sendImmediate(),
    sendNotificationDigests: () => defaultNotificationEmailJobs(appUrl, logger).sendDigests(),
    sendWeeklyDigests: () =>
      defaultWeeklyDigestJob(appUrl, logger, {
        posts: posts(),
        courses: courses(),
      }).sendWeeklyDigests(),
    purgeDueAccounts: () => defaultAccountPurge(logger)(),
    expireComps: () => getPaymentsService().expireComps(),
    sweepSubscriberMoves: () => getPaymentsService().sweepSubscriberMoves(),
    expireHolds: () => getPaymentsService().expireMembershipHolds(),
    queueRenewalReminders: () => getPaymentsService().queueRenewalReminders(),
    prepareRenewalReminder: (reminder) => getPaymentsService().prepareRenewalReminder(reminder),
    sendRenewalEmail: sendEmail,
    appUrl,
    endClosedBillingAccess: () => getPaymentsService().endClosedBillingAccess(),
    runMigration: (name, payload) => migrationRunners[name](getMigrationRuntime(), payload),
    expireMigrationFiles: () => expireMigrationFiles(getMigrationRuntime()),
    generateInvoices: () => getPlatformBillingService().generateInvoices(),
    reconcileBilling: () => getPlatformBillingService().reconcile(),
    backfillLastSeen: () => backfillMemberLastSeen(),
    webhooks: lazyWebhookJobs(appUrl, logger),
    expireApprovals: () => getApprovalsService().expireDue(),
    sweepDelegations: () => entitlements().sweepDelegations(),
    noticeExpiringTokens: () =>
      getTokenExpirySweep(appUrl, (tokenId, error) =>
        logger.warn({ tokenId, err: error }, "token expiry notice failed"),
      )(),
    pruneOAuthClients: () => getOAuthClientPrune()(),
    reencryptSecrets: async () => ({
      payments: await rotateStoredPaymentSecrets(),
      webhooks: await rotateStoredWebhookSecrets(),
    }),
    collectAgentFileGarbage: () => collectDefaultAgentFileGarbage(),
    sendQueuedEmail: (payload) => deliverQueuedEmail(getMailer(), payload),
  };
}
