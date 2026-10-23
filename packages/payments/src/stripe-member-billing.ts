import type Stripe from "stripe";

import type { CancellationDetails, PauseInput, PortalFlow, StripeAccount } from "./gateway";

export const paidThroughKey = "cohory_paid_through";

type FlowData = Stripe.BillingPortal.SessionCreateParams.FlowData;

function requestOptions(account: StripeAccount, idempotencyKey?: string): Stripe.RequestOptions {
  return {
    ...(account ? { stripeAccount: account } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

async function flowData(
  stripe: Stripe,
  account: StripeAccount,
  flow: PortalFlow,
  returnUrl: string,
): Promise<FlowData> {
  const afterCompletion: Stripe.BillingPortal.SessionCreateParams.FlowData.AfterCompletion = {
    type: "redirect",
    redirect: { return_url: returnUrl },
  };
  if (flow.type === "subscription_cancel") {
    return {
      type: "subscription_cancel",
      subscription_cancel: { subscription: flow.subscriptionId },
      after_completion: afterCompletion,
    };
  }
  const subscription = await stripe.subscriptions.retrieve(
    flow.subscriptionId,
    {},
    requestOptions(account),
  );
  const item = subscription.items.data[0];
  if (!item) {
    throw new Error("subscription has no item");
  }
  return {
    type: "subscription_update_confirm",
    subscription_update_confirm: {
      subscription: flow.subscriptionId,
      items: [{ id: item.id, price: flow.priceId, quantity: 1 }],
    },
    after_completion: afterCompletion,
  };
}

export async function createPortal(
  stripe: Stripe,
  account: StripeAccount,
  input: { customerId: string; returnUrl: string; flow?: PortalFlow },
  idempotencyKey: string,
): Promise<{ url: string }> {
  const flow = input.flow ? await flowData(stripe, account, input.flow, input.returnUrl) : null;
  const session = await stripe.billingPortal.sessions.create(
    {
      customer: input.customerId,
      return_url: input.returnUrl,
      ...(flow ? { flow_data: flow } : {}),
    },
    requestOptions(account, idempotencyKey),
  );
  return { url: session.url };
}

export function pause(
  stripe: Stripe,
  account: StripeAccount,
  subscriptionId: string,
  input: PauseInput,
  idempotencyKey: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(
    subscriptionId,
    {
      pause_collection: {
        behavior: "void",
        resumes_at: Math.floor(input.resumesAt.getTime() / 1000),
      },
      metadata: { [paidThroughKey]: input.paidThrough.toISOString() },
    },
    requestOptions(account, idempotencyKey),
  );
}

export function resume(
  stripe: Stripe,
  account: StripeAccount,
  subscriptionId: string,
  idempotencyKey: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(
    subscriptionId,
    { pause_collection: "", metadata: { [paidThroughKey]: "" } },
    requestOptions(account, idempotencyKey),
  );
}

export async function recordCancellationDetails(
  stripe: Stripe,
  account: StripeAccount,
  subscriptionId: string,
  details: CancellationDetails,
  idempotencyKey: string,
): Promise<void> {
  await stripe.subscriptions.update(
    subscriptionId,
    {
      cancellation_details: {
        ...(details.feedback ? { feedback: details.feedback } : {}),
        ...(details.comment ? { comment: details.comment } : {}),
      },
    },
    requestOptions(account, idempotencyKey),
  );
}
