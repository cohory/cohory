import { getQueueDatabase } from "@cohory/db";
import { PgBoss } from "pg-boss";

export const webhooksDeliverJob = "webhooks.deliver";
export const webhooksSweepJob = "webhooks.sweep";

export interface EnqueueOptions {
  readonly startAfter?: Date;
}

export interface DeliveryQueue {
  enqueue(deliveryId: string, options?: EnqueueOptions): Promise<void>;
}

export interface DeliverySender {
  createQueue(name: string): Promise<void>;
  send(
    name: string,
    data: object,
    options: { id?: string; startAfter?: Date; singletonKey?: string; singletonSeconds?: number },
  ): Promise<string | null>;
}

export function createDeliveryQueue(getSender: () => Promise<DeliverySender>): DeliveryQueue {
  let ready: Promise<DeliverySender> | undefined;
  function sender(): Promise<DeliverySender> {
    ready ??= getSender().then(async (s) => {
      await s.createQueue(webhooksDeliverJob);
      return s;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return {
    async enqueue(deliveryId, options = {}) {
      await (
        await sender()
      ).send(
        webhooksDeliverJob,
        { deliveryId },
        options.startAfter
          ? {
              startAfter: options.startAfter,
              singletonKey: `${deliveryId}:${options.startAfter.getTime()}`,
            }
          : // Throttled to one job per delivery per 30 seconds, finished jobs included, so a
            // resend passes startAfter to get past a job that just ran.
            { singletonKey: deliveryId, singletonSeconds: 30 },
      );
    },
  };
}

let shared: Promise<DeliverySender> | undefined;

function sharedSender(): Promise<DeliverySender> {
  shared ??= (async () => {
    const boss = new PgBoss({
      db: getQueueDatabase(),
      supervise: false,
      schedule: false,
    });
    await boss.start();
    return boss;
  })();
  shared.catch(() => {
    shared = undefined;
  });
  return shared;
}

let defaultQueue: DeliveryQueue | undefined;

export function getDeliveryQueue(): DeliveryQueue {
  defaultQueue ??= createDeliveryQueue(sharedSender);
  return defaultQueue;
}
