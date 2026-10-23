import { z } from "zod";

import type { RenewalReminder } from "./service/renewal-reminders";

export const feeRemovalJob = "payments.fee-removal";

export const feeRemovalJobPayloadSchema = z.object({ connectionId: z.uuid() });

export type FeeRemovalJobPayload = z.output<typeof feeRemovalJobPayloadSchema>;

export const exitRunJob = "payments.exit-run";

export const exitRunJobPayloadSchema = z.object({ runId: z.uuid(), communityId: z.uuid() });

export type ExitRunJobPayload = z.output<typeof exitRunJobPayloadSchema>;

export const exitRunQueueOptions = { retryLimit: 8, retryBackoff: true } as const;

export const memberBillingEndJob = "payments.member-billing-end";

export const memberBillingEndJobPayloadSchema = z.object({
  communityId: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(["removed", "banned"]),
});

export type MemberBillingEndJobPayload = z.output<typeof memberBillingEndJobPayloadSchema>;

export const memberBillingEndQueueOptions = { retryLimit: 8, retryBackoff: true } as const;

export const webhookEventJob = "payments.webhook.process";

export const webhookEventJobPayloadSchema = z.strictObject({
  providerEventId: z.uuid(),
  connectionId: z.uuid(),
});

export type WebhookEventJobPayload = z.output<typeof webhookEventJobPayloadSchema>;

export const webhookEventQueueOptions = {
  policy: "short",
  retryLimit: 10,
  retryDelay: 30,
  retryBackoff: true,
} as const;

export const billingWebhookEventJob = "payments.billing-webhook.process";

export const billingWebhookEventJobPayloadSchema = z.strictObject({ providerEventId: z.uuid() });

export type BillingWebhookEventJobPayload = z.output<typeof billingWebhookEventJobPayloadSchema>;

export const webhookSweepJob = "payments.webhook-sweep";

export const reconcileSweepJob = "payments.reconcile";

export const reconcileConnectionJob = "payments.reconcile.connection";

export const reconcileConnectionJobPayloadSchema = z.object({ connectionId: z.uuid() });

export type ReconcileConnectionJobPayload = z.output<typeof reconcileConnectionJobPayloadSchema>;

export const reconcileConnectionQueueOptions = {
  policy: "short",
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const;

export interface PaymentsJobs {
  scheduleFeeRemoval(payload: FeeRemovalJobPayload): Promise<void>;
  scheduleExitRun(payload: ExitRunJobPayload): Promise<void>;
  scheduleMemberBillingEnd(payload: MemberBillingEndJobPayload): Promise<void>;
  scheduleWebhookEvent(payload: WebhookEventJobPayload): Promise<void>;
  scheduleBillingWebhookEvent(payload: BillingWebhookEventJobPayload): Promise<void>;
  scheduleConnectionReconcile(payload: ReconcileConnectionJobPayload): Promise<void>;
  scheduleRenewalReminder(reminder: RenewalReminder): Promise<void>;
}
