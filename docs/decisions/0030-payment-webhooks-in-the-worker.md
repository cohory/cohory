# 0030. Payment webhooks run in the worker, with a daily reconciliation

The webhook request only verifies and stores a payment event and queues a job. The worker processes it with the same handlers. A daily job per connection repairs anything a lost event left wrong.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner under the founder's mandate (founder decision, 2026-10-22)
- Related: [0007](0007-stripe-connect-direct-charges.md), [0028](0028-stripe-disputes.md), [../architecture/payments.md](../architecture/payments.md) (sections 4.3, 13.3, 13.6), AGENTS.md sections 4 and 7

## Context

The payment webhook routes processed each event inside the HTTP request. One event could make several Stripe calls (20 second timeout, 2 retries each) before the route answered, so a slow Stripe or database could push the answer past Stripe's timeout and start a retry storm (Stripe review, 2026-10-21). AGENTS.md section 7 says webhook events are processed in the worker.

Nothing repaired state when an event was lost for good. Stripe stops retrying after three days, so a subscription cancelled during a longer outage kept access, and a missed `application_fee.created` or `charge.refunded` left the fee ledger wrong forever.

The webhook tests built Stripe objects by hand, so a change in Stripe's object shapes would not fail a test, and the Stripe object mappers for invoices, charges, and fees had no tests at all (tests review, 2026-10-21).

## Decision

1. **Store, queue, answer.** A webhook request verifies the signature, checks the mode, inserts the event into `provider_events` (unique per provider and event id), and queues the pg-boss job `payments.webhook.process` with `{ providerEventId, connectionId }`, ids only. It answers 200 `queued`. An event already processed answers 200 `duplicate`. If the job cannot be queued the request answers 500, the row stays unprocessed, and Stripe's retry queues it again.
2. **Process in the worker with the same handler.** The worker claims the row by id with the existing two minute lease, fetches the event from Stripe by its stored id (as the connected account when the event came from one), checks that its id and type match the row, fetches the current objects, writes, and marks the row processed. A failure clears the lease and fails the job, which pg-boss retries 10 times with backoff starting at 30 seconds. A job that finds the row claimed by another worker fails and retries later. A job for a row that is already processed does nothing. The queue uses the `short` policy, so a redelivery while the job is still waiting does not add a second job.
3. **No Stripe objects in the queue.** `provider_events` keeps only ids, the type, and a hash of the body, and the job carries only ids, so no customer data sits in the queue tables. Stripe keeps events retrievable for 30 days, far longer than the job retries. Polar has no API to fetch an event, so Polar deliveries are still processed in the request.
4. **No queue means inline.** A payments service built without a job queue (tests, scripts), or a provider without event retrieval, processes the verified event in the request, as before. The production service always has the queue.
5. **Platform billing events too.** Platform invoice and card setup events on `/api/webhooks/stripe` are recorded in `provider_events` (no connection) and queued as `payments.billing-webhook.process { providerEventId }`. The worker fetches the event from the platform account and runs the same billing handlers.
6. **Daily reconciliation per connection.** `payments.reconcile` runs at 03:45 UTC and queues `payments.reconcile.connection { connectionId }` for every `active` or `restricted` connection. The connection job lists the provider's subscriptions that are not cancelled and resyncs each one whose status, period end, or cancel flag differs from the mirror, or that carries this community's metadata and grants access but has no mirror. For Stripe it also lists the connected account's charges of the last 7 days and runs the fee and refund handlers for each, so a missed fee is recorded and a missed partial refund returns the fee share. Every write uses the same idempotency keys as the webhook path, so a run that finds nothing wrong changes nothing. Reconciliation may issue application fee refunds: this is accepted (coordinator product decision, 2026-10-22), because it only mirrors refunds Stripe already made to the member, and `cumulativeFeeRefundDue` with the key `fee-refund:{chargeId}:{refundedMinor}` never refunds more than the fee share or twice. Cancelled subscriptions are not listed; mirrored subscriptions that still grant access but are missing from the listing are fetched one by one instead. Each connection run stops after 5 minutes and the next day's run starts again.
7. **Failed events are not lost.** Stripe stops resending once we answer 200, so the worker owns retries: 10 job retries, then an hourly sweep queues again every Stripe event unprocessed for over an hour, for up to three days, for connections and platform billing alike. After three days the event is logged once at error level with its id and type, and an operator can queue it again with `pnpm billing replay-webhook <eventId>`.
8. **Recorded fixtures.** Events and objects for each handled Stripe event type were recorded in Stripe test mode on 2026-10-22 (API version `2026-09-30.endive`) and scrubbed of personal data. Tests replay them through the worker path and feed them to the gateway mappers.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep processing in the request | No queue | Slow answers, retry storms, against AGENTS.md section 7 | Decision 9 |
| Store the raw body in `provider_events` | Payload kept with the inbox row | Needs a migration and keeps personal data in a permanent table | Fetching by id needs neither |
| Carry the verified event in the job | No extra Stripe call | Full Stripe objects with customer details sit in the pg-boss tables until retention | Ids only; one extra read per event is cheap |
| Reconcile from the Events API | Replays exactly what was missed | Events are kept for 30 days and per account listing is noisy | Listing current objects is simpler and state based |
| List application fees on the platform | One list for all connections | No filter by account, so every connection job scans every fee | Charges on the connected account carry the fee id |

## Consequences

- Positive: webhook answers take one insert and one queue write, and a Stripe or database slowdown only delays processing.
- Positive: a lost event is repaired within a day; a missed refund still returns the platform fee.
- Positive: a change in Stripe's object shapes fails the recorded fixture tests.
- Negative: access changes from webhooks now wait for the worker, normally a second or two.
- Negative: each processed event costs one more Stripe read, and an event older than 30 days can no longer be processed (the reconciliation covers it).
- Negative: Polar deliveries stay in the request until Polar offers event retrieval or is removed.
- Negative: the daily run fetches every drifted subscription and every recent fee. Large communities make more Stripe reads at 03:45 UTC.
- Follow up: `checkout.session.completed`, `radar.early_fraud_warning.created`, and `account.application.deauthorized` were not recorded (they need a browser checkout, a fraud test card on a raw card number, or disconnecting the sandbox account) and keep hand built events.
