import { PaymentsUnavailableError } from "../errors";
import type { PaymentsJobs } from "../jobs";
import type { StaleEvent } from "../repository";
import type { Runtime } from "./context";
import { eventLeaseMs } from "./webhooks";

export const requeueAfterMs = 60 * 60_000;
export const giveUpAfterMs = 3 * 24 * 60 * 60_000;

const batchSize = 500;

export interface WebhookSweepResult {
  readonly requeued: number;
  readonly abandoned: number;
}

export type WebhookReplayResult = { readonly kind: "queued" | "processed" | "not_found" };

export interface WebhookSweepOperations {
  sweepWebhookEvents(): Promise<WebhookSweepResult>;
  replayWebhookEvent(externalEventId: string): Promise<WebhookReplayResult>;
}

async function requeue(jobs: PaymentsJobs, event: StaleEvent): Promise<void> {
  if (event.connectionId) {
    await jobs.scheduleWebhookEvent({
      providerEventId: event.rowId,
      connectionId: event.connectionId,
    });
    return;
  }
  await jobs.scheduleBillingWebhookEvent({ providerEventId: event.rowId });
}

export function createWebhookSweepOperations(runtime: Runtime): WebhookSweepOperations {
  const { repo } = runtime;

  async function abandon(now: Date): Promise<number> {
    const events = await repo.listAbandonedEvents(
      new Date(now.getTime() - giveUpAfterMs),
      batchSize,
    );
    for (const event of events) {
      runtime.log({
        msg: "payment webhook event abandoned",
        level: "error",
        provider: event.provider,
        eventId: event.externalEventId,
        type: event.type,
      });
    }
    await repo.markEventsAbandoned(events.map((event) => event.rowId));
    return events.length;
  }

  return {
    async sweepWebhookEvents() {
      const now = runtime.now();
      const abandoned = await abandon(now);
      const { jobs } = runtime;
      if (!jobs) {
        return { requeued: 0, abandoned };
      }
      const stale = await repo.listStaleEvents({
        receivedBefore: new Date(now.getTime() - requeueAfterMs),
        receivedAfter: new Date(now.getTime() - giveUpAfterMs),
        claimedBefore: new Date(now.getTime() - eventLeaseMs),
        limit: batchSize,
      });
      for (const event of stale) {
        await requeue(jobs, event);
      }
      return { requeued: stale.length, abandoned };
    },

    async replayWebhookEvent(externalEventId) {
      const event = await repo.findStripeEvent(externalEventId);
      if (!event) {
        return { kind: "not_found" };
      }
      if (event.processed) {
        return { kind: "processed" };
      }
      if (!runtime.jobs) {
        throw new PaymentsUnavailableError("payment jobs");
      }
      await requeue(runtime.jobs, event);
      return { kind: "queued" };
    },
  };
}
