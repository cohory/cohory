# Payment providers

How a creator connects a payment provider to a community, what each provider supports, and how the platform fee is handled. The design is in [payments.md](../architecture/payments.md) section 8. One community has one open connection at a time.

## Which providers you can choose

Polar is off by default on both editions. Polar's [acceptable use policy](https://polar.sh/docs/merchant-of-record/acceptable-use) does not allow marketplaces or selling "community access", which is what Cohory memberships are. An operator can turn it on with `COHORY_ENABLE_POLAR=true`. While it is off, Polar is not listed in Manage, Payments, a new Polar connection is refused, and checkouts on an existing Polar connection are refused. Existing Polar connections keep their webhook route and keep syncing, so members' access stays correct, and the owner sees "Polar is no longer offered" with the advice to disconnect Polar and connect Stripe.

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
| Refund API | Yes (Cohory refunds a duplicate second subscription by itself; creators refund in Stripe) | Yes (the same) | Yes (creators refund in Polar) |
| Dispute events | Yes (recorded on the payment, the owner is notified, and a lost dispute refunds the fee on the disputed amount) | Yes (recorded, owner notified) | No, Polar handles disputes |
| Trial on resubscribe | Yes | Yes | No |

## Connect Stripe Connect (Cloud)

Open Manage, Payments, choose the country of your business, keep Stripe Connect selected, and choose Connect your Stripe account. Stripe's hosted form collects your business details. Testing against a sandbox is described in [testing.md](../open-source/testing.md#testing-payments-against-stripe-test-mode).

The operator registers two webhook destinations in the platform's Stripe Dashboard, both pointing at `/api/webhooks/stripe`, with API version `2026-09-30.endive` (the version the Stripe client pins; upgrade the endpoints and the `stripe` package together):

| Destination | Signing secret | Events |
|---|---|---|
| Connected accounts | `STRIPE_CONNECT_WEBHOOK_SECRET` | `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `radar.early_fraud_warning.created`, `account.updated`, `account.application.deauthorized` |
| Your account | `STRIPE_WEBHOOK_SECRET` | `application_fee.created`, `application_fee.refunded`, plus the platform billing events listed in [platform-billing.md](platform-billing.md#what-the-operator-runs) |

Events the destination sends but Cohory does not handle are answered as ignored. The design (one endpoint, two secrets, processing in the worker) is in [payments.md](../architecture/payments.md) section 4.

## Connect your own Stripe keys (Community Edition)

The operator sets `PAYMENTS_ENCRYPTION_KEY`. In Manage, Payments, paste a secret or restricted key and the webhook signing secret. Cohory then shows the webhook URL to add in Stripe (`/api/webhooks/stripe/own/{connectionId}`). Select the same events as the Connected accounts destination above; the application fee events do not apply to your own account.

## Connect Polar

The operator sets `PAYMENTS_ENCRYPTION_KEY` (32 bytes, base64). Production Polar accounts are refused unless the server runs with `NODE_ENV=production`.

1. In Polar, create an organization access token under Settings. It needs these scopes: `organizations:read`, `products:read`, `products:write`, `checkouts:write`, `orders:read`, `subscriptions:read`, `subscriptions:write`, `refunds:write`, `customer_sessions:write`, and `customers:write` (used only when a member deletes their account).
2. In Cohory, open Manage, Payments, choose Polar, paste the token, and choose Sandbox or Production. Cohory checks the token by reading your organization before it stores anything. The token is stored encrypted.
3. Cohory shows a webhook URL of the form `https://your-server/api/webhooks/payments/{connectionId}`. In Polar, open Settings, Webhooks, add an endpoint with that URL, choose the raw format, and select `checkout.updated`, `order.paid`, `order.refunded`, `organization.updated`, and every `subscription` event.
4. Copy the signing secret Polar shows for that endpoint and paste it into Cohory. The connection turns ready once the secret is saved and Polar reports that your organization can take checkout payments.
5. Choose Send test event. Cohory signs a test event with the saved secret and posts it to the public webhook URL, then shows when the last event arrived. This proves that the URL is reachable and the secret is saved. It does not prove the event list in Polar; the first real order does.
6. Set a price. Cohory creates one Polar product per billing period, named after the plan.

Members then buy through Polar Checkout, get their receipt from Polar, and manage or cancel their membership in the Polar customer portal from the membership page.

To disconnect, choose Disconnect Polar. Sales stop and the plan is archived; existing subscriptions keep billing in Polar and members keep access until they end.

## How the platform fee is handled on Polar

Polar cannot take a fee for a third party at checkout. On Cloud, every paid Polar order writes one `fee_accrued` row to the fee ledger: 2% (round half up) of the amount paid minus tax stated separately. A refund writes a `fee_refunded` row for the share of the fee that is no longer owed. Monthly platform billing of these rows is described in [payments.md](../architecture/payments.md) section 9. While a platform invoice is 30 days past due, new paid signups in that community are paused with a plain message; existing members keep access. Stripe Connect checkouts are not paused, because Stripe takes that fee at charge time. The Community Edition records no fee.

## Testing without a Polar account

`packages/payments/support/fake-polar/server.mts` stands in for the Polar API, the hosted checkout, the customer portal, and the webhook settings page. Start it with `FAKE_POLAR_PORT=12112 node packages/payments/support/fake-polar/server.mts`, set `POLAR_API_BASE_URL=http://localhost:12112` for the app, and open `http://localhost:12112/dashboard/webhooks` to register the app's webhook URL and get a signing secret. Fixture routes under `/__fixtures/` list the recorded calls and deliveries and can deliver any signed event. Leave `POLAR_API_BASE_URL` empty in production.

## Local development with a Stripe sandbox

`pnpm db:seed` creates the private community Cohory Pro (`/c/cohory-pro`) owned by `owner@cohory.local`, with join mode approval, an invite link (`/join/cohory-pro-invite-link-for-local-paid-tests`), a welcome post, and `member@cohory.local` as an active member without a subscription, but with no price and no payment connection, so tests and fresh installs work offline. The paid part is a separate step that needs a Stripe sandbox and is never part of `db:seed` or CI:

1. Put a sandbox key (`sk_test_`) in `STRIPE_SECRET_KEY` in the root `.env`, set `COHORY_EDITION=cloud`, enable Connect in the sandbox, and start the webhook listener with `scripts/stripe-dev.sh` (default port 3000). It forwards platform and Connect events to one URL with one signing secret, so put the `whsec_` value it prints into both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` and restart the web app and the worker. Start the listener after Connect is enabled. The full setup is in [testing.md](../open-source/testing.md#testing-payments-against-stripe-test-mode).
2. Set `PAID_SEED_ACCOUNT_ID` to a connected account (`acct_`) in that sandbox.
3. Run `pnpm db:seed` and then `pnpm db:seed:paid` (`packages/payments/src/seed-paid-cli.ts`, reads the root `.env`).

The paid seed refuses to run when `NODE_ENV` is `production`, when `STRIPE_SECRET_KEY` is not an `sk_test_` key, or when `COHORY_EDITION` is not `cloud`, and refuses with the reason when the named account is live, cannot take charges, or is already connected to another community. It stores a `stripe_connect` connection for Cohory Pro with the account's state (the same row Cloud onboarding produces) and saves the plan through the payments service, so the Product and the USD 19.00 monthly and USD 190.00 yearly Prices get the production metadata and idempotency keys. Putting the plan on sale turns the join mode from approval to open. Checkout applies the configured platform fee (`PLATFORM_FEE_BPS`, 200 by default on Cloud). A second run finds the connection and the plan and creates nothing. It prints only ids, never keys, and touches no other object on the account.

Then sign in as `user@cohory.local`, open `/c/cohory-pro`, and buy the membership with a Stripe test card.

The end to end stacks (`pnpm e2e:host` and `pnpm e2e`) run the same paid seed against the fake Stripe server, on a connected account the fake creates and passes in `PAID_SEED_ACCOUNT_ID`, so the seeded About page shows the price. `pnpm db:reset:local --yes` runs the paid seed after the seed and only warns when it refuses, for example without a sandbox key. Recorded Stripe events and objects for the unit and integration suites live in `packages/payments/src/test/fixtures/stripe` (recorded 2026-10-22, API version `2026-09-30.endive`, personal data removed); a unit test fails when they disagree with the pinned API version.

## Checking pause on a Stripe test clock

Pause and resume are covered by tests against a fake gateway only. Before a release that changes them, a person with a Stripe sandbox checks the real behavior once:

1. Create a test clock, a customer on it with a test card, and a monthly subscription through the community's Checkout.
2. Pause it for one month from the Membership page. Check in Stripe that `pause_collection.behavior` is `void` and `resumes_at` is the paid through date plus one month.
3. Advance the clock past the paid through date. The member loses access and gets no invoice for the paused month.
4. Advance the clock past `resumes_at`. Payments start again, the first invoice charges the normal price once, and the member is let back in.

This is a human gate in the [backlog](../product/backlog.md).

## Decisions and open questions

- **Confirmed** (0.5.0, recorded in [0051](../decisions/0051-payment-provider-decisions-without-records.md)): Polar is the first bring your own provider, chosen as the first candidate with a public sandbox. [0027](../decisions/0027-safe-exit-and-2-percent-fee.md) later switched it off by default.
- **Assumption:** Polar's order `refunded_amount` excludes tax. To verify in the sandbox.
- **Open question:** a live run against the Polar sandbox (connect, checkout with a test card, renewal, refund, portal cancel) is a human gate, because it needs a Polar account.
- **Confirmed** (founder decision, 2026-10-19): no creator attestation of revenue a provider reports. Cohory fetches each order from the API after a signed webhook, and the daily `billing.reconcile` job checks totals ([platform-billing.md](platform-billing.md)); that is enough. Periodic order listing is not built.
