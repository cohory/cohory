# Payment providers

Status: Draft, 2026-10-23

How a creator connects a payment provider to a community, what each provider supports, and how the platform fee is handled. The design is in [payments.md](../architecture/payments.md) section 8. One community has one open connection at a time.

## Which providers you can choose

Polar is off by default on both editions. Polar's [acceptable use policy](https://polar.sh/docs/merchant-of-record/acceptable-use) does not allow marketplaces or selling "community access", which is what cohory memberships are. An operator can turn it on with `COHORY_ENABLE_POLAR=true`. While it is off, Polar is not listed in Manage, Payments, a new Polar connection is refused, and checkouts on an existing Polar connection are refused. Existing Polar connections keep their webhook route and keep syncing, so members' access stays correct, and the owner sees "Polar is no longer offered" with the advice to disconnect Polar and connect Stripe.

| Provider | Cloud | Community Edition | Platform fee | How the fee is collected |
|---|---|---|---|---|
| Stripe Connect | Yes | No | 2% (`PLATFORM_FEE_BPS`) | Taken at charge time as a Stripe application fee |
| Stripe own keys | No | Yes | None | Not applicable |
| Polar (off unless `COHORY_ENABLE_POLAR=true`) | Yes | Yes | 2% on Cloud, none on the Community Edition | Recorded in the fee ledger as accrued and billed to the creator monthly |

Processing fees are always separate and charged by the provider. Polar is the merchant of record for the sale, so Polar's own fee and sales tax handling apply.

## What each provider supports

| | Stripe Connect | Stripe own keys | Polar |
|---|---|---|---|
| Hosted checkout | Yes | Yes | Yes |
| Customer portal for members | Yes | Yes | Yes |
| Link existing subscriptions ([payment-migration.md](payment-migration.md)) | Yes | Yes | No |
| Fee split at checkout | Yes | Not applicable | No |
| Refund API | Yes (cohory refunds a duplicate second subscription by itself; creators refund in Stripe) | Yes (the same) | Yes (creators refund in Polar) |
| Dispute events | Yes (recorded on the payment, the owner is notified, and a lost dispute refunds the fee on the disputed amount) | Yes (recorded, owner notified) | No, Polar handles disputes |
| Trial on resubscribe | Yes | Yes | No |

## Connect Stripe Connect (Cloud)

Open Manage, Payments, keep Stripe Connect selected, and choose Connect your Stripe account. Stripe's hosted form collects your business details. Testing against a sandbox is described in [testing.md](../open-source/testing.md#testing-payments-against-stripe-test-mode).

## Connect your own Stripe keys (Community Edition)

The operator sets `PAYMENTS_ENCRYPTION_KEY`. In Manage, Payments, paste a secret or restricted key and the webhook signing secret. cohory then shows the webhook URL to add in Stripe (`/api/webhooks/stripe/own/{connectionId}`).

## Connect Polar

The operator sets `PAYMENTS_ENCRYPTION_KEY` (32 bytes, base64). Production Polar accounts are refused unless the server runs with `NODE_ENV=production`.

1. In Polar, create an organization access token under Settings. It needs these scopes: `organizations:read`, `products:read`, `products:write`, `checkouts:write`, `orders:read`, `subscriptions:read`, `subscriptions:write`, `refunds:write`, `customer_sessions:write`, and `customers:write` (used only when a member deletes their account).
2. In cohory, open Manage, Payments, choose Polar, paste the token, and choose Sandbox or Production. cohory checks the token by reading your organization before it stores anything. The token is stored encrypted.
3. cohory shows a webhook URL of the form `https://your-server/api/webhooks/payments/{connectionId}`. In Polar, open Settings, Webhooks, add an endpoint with that URL, choose the raw format, and select `checkout.updated`, `order.paid`, `order.refunded`, `organization.updated`, and every `subscription` event.
4. Copy the signing secret Polar shows for that endpoint and paste it into cohory. The connection turns ready once the secret is saved and Polar reports that your organization can take checkout payments.
5. Choose Send test event. cohory signs a test event with the saved secret and posts it to the public webhook URL, then shows when the last event arrived. This proves that the URL is reachable and the secret is saved. It does not prove the event list in Polar; the first real order does.
6. Set a price. cohory creates one Polar product per billing period, named after the plan.

Members then buy through Polar Checkout, get their receipt from Polar, and manage or cancel their membership in the Polar customer portal from the membership page.

To disconnect, choose Disconnect Polar. Sales stop and the plan is archived; existing subscriptions keep billing in Polar and members keep access until they end.

## How the platform fee is handled on Polar

Polar cannot take a fee for a third party at checkout. On Cloud, every paid Polar order writes one `fee_accrued` row to the fee ledger: 2% (round half up) of the amount paid minus tax stated separately. A refund writes a `fee_refunded` row for the share of the fee that is no longer owed. Monthly platform billing of these rows is described in [payments.md](../architecture/payments.md) section 9. While a platform invoice is 30 days past due, new paid signups in that community are paused with a plain message; existing members keep access. Stripe Connect checkouts are not paused, because Stripe takes that fee at charge time. The Community Edition records no fee.

## Testing without a Polar account

`packages/payments/support/fake-polar/server.mts` stands in for the Polar API, the hosted checkout, the customer portal, and the webhook settings page. Start it with `FAKE_POLAR_PORT=12112 node packages/payments/support/fake-polar/server.mts`, set `POLAR_API_BASE_URL=http://localhost:12112` for the app, and open `http://localhost:12112/dashboard/webhooks` to register the app's webhook URL and get a signing secret. Fixture routes under `/__fixtures/` list the recorded calls and deliveries and can deliver any signed event. Leave `POLAR_API_BASE_URL` empty in production.

## Checking pause on a Stripe test clock

Pause and resume are covered by tests against a fake gateway only. Before a release that changes them, a person with a Stripe sandbox checks the real behavior once:

1. Create a test clock, a customer on it with a test card, and a monthly subscription through the community's Checkout.
2. Pause it for one month from the Membership page. Check in Stripe that `pause_collection.behavior` is `void` and `resumes_at` is the paid through date plus one month.
3. Advance the clock past the paid through date. The member loses access and gets no invoice for the paused month.
4. Advance the clock past `resumes_at`. Payments start again, the first invoice charges the normal price once, and the member is let back in.

This is a human gate in the [backlog](../product/backlog.md).

## Decisions and open questions

- **Decided** (0.5.0): Polar is the first bring your own provider (gate default: first candidate with a public sandbox).
- **Assumption:** Polar's order `refunded_amount` excludes tax. To verify in the sandbox.
- **Open question:** a live run against the Polar sandbox (connect, checkout with a test card, renewal, refund, portal cancel) is a human gate, because it needs a Polar account.
- **Confirmed** (founder decision, 2026-10-19): no creator attestation of revenue a provider reports. cohory fetches each order from the API after a signed webhook, and the daily `billing.reconcile` job checks totals ([platform-billing.md](platform-billing.md)); that is enough. Periodic order listing is not built.
