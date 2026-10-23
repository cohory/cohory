import { createHash } from "node:crypto";

import { communityIdSchema } from "@cohory/db";
import { z } from "zod";

import type { SubscriptionRecord } from "../repository";
import type { Runtime } from "./context";
import { priceOf } from "./member-billing";

export const renewalReminderJob = "payments.renewal-reminder";
export const renewalReminderLeadDays = 7;
export const renewalReminderBatch = 500;
export const renewalReminderQueueOptions = {
  retryLimit: 5,
  retryBackoff: true,
  deleteAfterSeconds: 30 * 24 * 60 * 60,
} as const;

const dayMs = 24 * 60 * 60 * 1000;

export const renewalReminderSchema = z.strictObject({
  subscriptionId: z.uuid(),
  communityId: z.uuid(),
  renewsAt: z.iso.datetime(),
});

export type RenewalReminder = z.infer<typeof renewalReminderSchema>;

export interface RenewalReminderMessage {
  readonly email: string;
  readonly communityName: string;
  readonly communitySlug: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly renewsAt: Date;
}

export interface RenewalReminderOperations {
  queueRenewalReminders(): Promise<{ readonly queued: number }>;
  prepareRenewalReminder(reminder: RenewalReminder): Promise<RenewalReminderMessage | null>;
}

export function renewalReminderJobId(
  reminder: Pick<RenewalReminder, "subscriptionId" | "renewsAt">,
): string {
  const hex = createHash("sha256")
    .update(`renewal-reminder:${reminder.subscriptionId}:${reminder.renewsAt}`)
    .digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export function renewalReminderWindow(now: Date): { from: Date; to: Date } {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = new Date(day + renewalReminderLeadDays * dayMs);
  return { from, to: new Date(from.getTime() + dayMs) };
}

async function dueReminders(runtime: Runtime): Promise<RenewalReminder[]> {
  const { from, to } = renewalReminderWindow(runtime.now());
  const due = await runtime.repo.listYearlyRenewals(from, to, renewalReminderBatch);
  return due.map((renewal) => ({
    subscriptionId: renewal.subscriptionId,
    communityId: renewal.communityId,
    renewsAt: renewal.renewsAt.toISOString(),
  }));
}

function stillRenews(subscription: SubscriptionRecord, renewsAt: string): boolean {
  return (
    subscription.providerStatus === "active" &&
    subscription.accessState === "granted" &&
    !subscription.cancelAtPeriodEnd &&
    subscription.interval === "year" &&
    subscription.currentPeriodEnd?.toISOString() === renewsAt
  );
}

async function prepare(
  runtime: Runtime,
  reminder: RenewalReminder,
): Promise<RenewalReminderMessage | null> {
  const parsed = renewalReminderSchema.parse(reminder);
  const communityId = communityIdSchema.parse(parsed.communityId);
  const community = await runtime.repo.findCommunity(communityId);
  if (!community) {
    return null;
  }
  return runtime.repo.inCommunityAsSystem(communityId, async (store) => {
    const subscription = await store.findSubscription(parsed.subscriptionId);
    if (!subscription || !stillRenews(subscription, parsed.renewsAt)) {
      return null;
    }
    const [closedAt, plan, email] = await Promise.all([
      store.findConnectionClosedAt(subscription.connectionId),
      subscription.planId ? store.findPlan(subscription.planId) : null,
      store.findReachableEmail(subscription.userId),
    ]);
    const price = priceOf(subscription, plan);
    if (closedAt || !price || !email) {
      return null;
    }
    return {
      email,
      communityName: community.name,
      communitySlug: community.slug,
      amountMinor: price.amountMinor,
      currency: price.currency,
      renewsAt: new Date(parsed.renewsAt),
    };
  });
}

export function createRenewalReminderOperations(runtime: Runtime): RenewalReminderOperations {
  return {
    async queueRenewalReminders() {
      const jobs = runtime.jobs;
      if (!jobs) {
        return { queued: 0 };
      }
      const reminders = await dueReminders(runtime);
      for (const reminder of reminders) {
        await jobs.scheduleRenewalReminder(reminder);
      }
      return { queued: reminders.length };
    },

    prepareRenewalReminder(reminder) {
      return prepare(runtime, reminder);
    },
  };
}
