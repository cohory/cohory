import type { Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GatewaySubscription } from "./gateway";
import type { PaymentsJobs } from "./jobs";
import { renewalReminderJobId, type RenewalReminder } from "./service/renewal-reminders";
import { signedEvent, stripeDelivery } from "./test/fake-gateway";
import { openProbeDb, openTestDb } from "./test/fixtures";
import { createHarness, setupPaidCommunity, stripeSubscription } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

const now = new Date("2026-10-22T10:00:00.000Z");
const inWindow = new Date("2026-10-29T15:00:00.000Z");

function recordingJobs(): PaymentsJobs & { readonly reminders: RenewalReminder[] } {
  const reminders: RenewalReminder[] = [];
  const none = async () => {};
  return {
    reminders,
    scheduleFeeRemoval: none,
    scheduleExitRun: none,
    scheduleMemberBillingEnd: none,
    scheduleWebhookEvent: none,
    scheduleBillingWebhookEvent: none,
    scheduleConnectionReconcile: none,
    scheduleRenewalReminder: async (reminder) => {
      reminders.push(reminder);
    },
  };
}

async function withSubscriptions(variants: readonly Partial<GatewaySubscription>[]) {
  const jobs = recordingJobs();
  const harness = createHarness(probe.db, undefined, jobs);
  harness.clock.now = now;
  const paid = await setupPaidCommunity(admin.db, harness);
  for (const overrides of variants) {
    const subscription = stripeSubscription(paid, paid.buyerId, overrides);
    harness.gateway.subscriptions.set(subscription.id, subscription);
    const event = signedEvent(
      "customer.subscription.created",
      { id: subscription.id, object: "subscription" },
      { account: paid.accountId },
    );
    await harness.service.handleWebhook(
      { setup: "platform_account" },
      stripeDelivery({
        rawBody: event.rawBody,
        signature: event.signature,
      }),
    );
  }
  return { harness, paid, jobs };
}

async function queued(overrides: Partial<GatewaySubscription> = {}) {
  const setup = await withSubscriptions([
    { interval: "year", currentPeriodEnd: inWindow, ...overrides },
  ]);
  await setup.harness.service.queueRenewalReminders();
  const reminder = setup.jobs.reminders.find((r) => r.communityId === setup.paid.communityId);
  if (!reminder) throw new Error("no reminder queued");
  return { ...setup, reminder };
}

async function changeSubscription(
  setup: Awaited<ReturnType<typeof queued>>,
  patch: Partial<GatewaySubscription>,
) {
  const [id, current] =
    [...setup.harness.gateway.subscriptions.entries()].find(
      ([, subscription]) => subscription.metadata["cohory_community_id"] === setup.paid.communityId,
    ) ?? [];
  if (!id || !current) throw new Error("no subscription");
  setup.harness.gateway.subscriptions.set(id, { ...current, ...patch });
  const event = signedEvent(
    "customer.subscription.updated",
    { id, object: "subscription" },
    { account: setup.paid.accountId },
  );
  await setup.harness.service.handleWebhook(
    { setup: "platform_account" },
    stripeDelivery({
      rawBody: event.rawBody,
      signature: event.signature,
    }),
  );
}

describe("sending a renewal reminder", () => {
  it("reads the address, amount, and date when it sends, not when it queued", async () => {
    const setup = await queued();
    await admin.db
      .update(users)
      .set({ email: `renamed-${setup.paid.buyerId}@example.test` })
      .where(eq(users.id, setup.paid.buyerId));

    const message = await setup.harness.service.prepareRenewalReminder(setup.reminder);

    expect(message).toEqual({
      email: `renamed-${setup.paid.buyerId}@example.test`,
      communityName: "Paid circle",
      communitySlug: expect.any(String),
      amountMinor: 49_000,
      currency: "usd",
      renewsAt: inWindow,
    });
  });

  it("sends nothing to a member whose account was erased", async () => {
    const setup = await queued();
    await admin.db.update(users).set({ erasedAt: now }).where(eq(users.id, setup.paid.buyerId));

    expect(await setup.harness.service.prepareRenewalReminder(setup.reminder)).toBeNull();
  });

  it.each([
    ["set to cancel at period end", { cancelAtPeriodEnd: true }],
    ["no longer active", { status: "canceled", endedAt: now }],
    ["renewing on another date", { currentPeriodEnd: new Date("2026-11-05T15:00:00.000Z") }],
  ])("sends nothing once the subscription is %s", async (_name, patch) => {
    const setup = await queued();
    await changeSubscription(setup, patch);

    expect(await setup.harness.service.prepareRenewalReminder(setup.reminder)).toBeNull();
  });
});

describe("yearly renewal reminders", () => {
  it("queues one reminder with the yearly price for a renewal seven days out", async () => {
    const { harness, paid, jobs } = await withSubscriptions([
      { interval: "year", currentPeriodEnd: inWindow },
    ]);

    await harness.service.queueRenewalReminders();

    const mine = jobs.reminders.filter((reminder) => reminder.communityId === paid.communityId);
    expect(mine).toEqual([
      {
        subscriptionId: expect.any(String),
        communityId: paid.communityId,
        renewsAt: inWindow.toISOString(),
      },
    ]);
  });

  it.each([
    ["a monthly membership", { interval: "month" as const, currentPeriodEnd: inWindow }],
    [
      "a yearly membership that will not renew",
      { interval: "year" as const, currentPeriodEnd: inWindow, cancelAtPeriodEnd: true },
    ],
    [
      "a yearly membership renewing on another day",
      { interval: "year" as const, currentPeriodEnd: new Date("2026-10-30T15:00:00.000Z") },
    ],
  ])("skips %s", async (_name, overrides) => {
    const { harness, paid, jobs } = await withSubscriptions([overrides]);

    await harness.service.queueRenewalReminders();

    expect(jobs.reminders.filter((r) => r.communityId === paid.communityId)).toEqual([]);
  });

  it("names each reminder job after the subscription and renewal date so a rerun adds none", () => {
    const reminder = { subscriptionId: "0190a000-0000-7000-8000-000000000001", renewsAt: "x" };

    expect(renewalReminderJobId(reminder)).toBe(renewalReminderJobId({ ...reminder }));
    expect(renewalReminderJobId(reminder)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(renewalReminderJobId({ ...reminder, renewsAt: "y" })).not.toBe(
      renewalReminderJobId(reminder),
    );
  });
});
