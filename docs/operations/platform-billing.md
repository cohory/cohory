# Platform billing

Status: Draft, 2026-10-19

How cohory Cloud bills creators for the 2% platform fee when their payment provider cannot collect it at charge time. Stripe Connect communities never see an invoice: Stripe takes the fee from each payment. This page covers what creators see, what the platform operator runs, and how to resend or void an invoice. The design is in [../architecture/payments.md](../architecture/payments.md) sections 9 and 13.11.

Platform billing runs only on the Cloud edition (`COHORY_EDITION=cloud`) with `STRIPE_SECRET_KEY` set to the platform account. Self-hosted Community Edition servers have no platform fee and nothing on this page applies to them.

## What creators see

Owners and admins open Manage, Payments, Platform fees (`/c/{slug}/manage/payments/platform-fees`).

| Section | Shows |
|---|---|
| This month | Fees so far this month per currency, fees carried forward from earlier months, and the next invoice date (the first of next month) |
| Billing details | The saved card, if any, and the billing email. Only the owner can change them |
| Invoices | One row per month and currency with the amount, the status (Preparing, Due, Past due, Paid, Canceled, Unpaid), and a link to the Stripe hosted invoice |
| Billing checks | Differences found by the daily check, if any |

The owner saves a card with Add a card, which opens a Stripe page. With a card on file, invoices are charged automatically. Without one, Stripe emails the invoice with its PDF to the billing email (the owner's email when none is set); it is due in 14 days. cohory does not send a second copy.

Rules creators should know:

- Invoices below 5 USD (or the fixed equivalent in the invoice currency, for example 4 GBP or 750 JPY) are not sent. The amount carries forward to the next month.
- Refunds made through the provider reduce the next invoice.
- If a payment fails, the invoice shows Past due and the owner gets one email from cohory with links to the invoice and the Platform fees page. The same links are in the email that says paid signups are paused. If it is still unpaid 30 days later, new paid signups through providers billed this way (Polar) pause until it is paid; members trying to join see "New memberships are paused in this community for now. Try again later." Stripe Connect checkout stays open, because Stripe already takes that fee at charge time. Existing members keep their access, and exports stay available.

## What the operator runs

The worker runs two scheduled jobs. Nothing needs to be started by hand.

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `billing.invoice` | 00:15 on the first of each month | Invoices the month that just closed, per community and currency |
| `billing.reconcile` | 03:30 daily | Syncs open invoices from Stripe, pauses or resumes paid signups, and checks totals |

Stripe must send platform events to `/api/webhooks/stripe` with `STRIPE_WEBHOOK_SECRET`. Add these events to the platform ("Your account") endpoint: `invoice.finalized`, `invoice.sent`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`, `invoice.overdue`, and `checkout.session.completed`. Turn on Stripe's invoice reminders in the Dashboard if you want reminders before the due date. Stripe's customer emails for invoices and receipts must be on (Dashboard, Settings, Customer emails), because cohory no longer emails the invoice itself. Create the endpoint with API version `2026-09-30.endive`, the version the Stripe client pins; upgrade the endpoint and the `stripe` package together.

Watch the worker log for these lines:

| Log message | Meaning |
|---|---|
| `platform invoices generated` | Monthly run finished, with counts created, carried forward, issued, and failed |
| `platform invoice could not be issued` | Stripe refused a call; the invoice stays a draft and the next run retries |
| `platform invoice past due` | A payment failed or the due date passed |
| `platform billing suspended paid signups` | 30 days past due; new paid signups through Polar paused |
| `platform billing mismatch` | The daily check found a difference (see below) |

## Commands

Run these from the repository with the production environment loaded (`pnpm billing ...`), or inside the worker container as `node apps/worker/dist/billing-cli.js ...` (for example `docker compose exec worker node apps/worker/dist/billing-cli.js invoice`). Every command is safe to repeat.

| Command | Use |
|---|---|
| `pnpm billing invoice` | Run the monthly invoice job now for last month |
| `pnpm billing invoice 2026-09` | Invoice a specific closed month, for example after an outage on the first |
| `pnpm billing reconcile` | Run the daily check now |
| `pnpm billing sync <communityId> <invoiceId>` | Pull one invoice's status from Stripe |
| `pnpm billing resend <communityId> <invoiceId>` | Ask Stripe to email the open invoice to the billing email again |
| `pnpm billing void <communityId> <invoiceId>` | Void the invoice in Stripe and in cohory |
| `pnpm billing replay-webhook <eventId>` | Queue one stored Stripe webhook event again (see the [operator guide](operator-guide.md#payment-webhooks-that-did-not-process)) |

Ids are the cohory ids shown in the `platform_invoices` table and in the log lines. Voiding waives the fees on that invoice: its ledger entries stay attached and are never billed again. To bill a corrected amount after voiding, record an `adjustment` entry in the ledger; it is picked up by the next monthly run.

## Billing checks

| Kind | Meaning | What to do |
|---|---|---|
| `ledger_amount_mismatch` | The invoice amount differs from its ledger entries | Investigate before the creator pays; void and adjust if the invoice is wrong |
| `stripe_amount_mismatch` | The Stripe invoice total or currency differs from cohory's amount | Someone edited the invoice in Stripe; void it and invoice again |
| `stripe_invoice_missing` | The invoice exists in cohory for over a day without a Stripe invoice | Check the log for the Stripe error, then run `pnpm billing invoice` |
| `provider_total_mismatch` | The provider reports a different gross for the month than the ledger | Compare the provider's export with the ledger; only shows once a provider reports totals |

Checks resolve themselves when the next daily run no longer finds the difference.

## Open questions

Resolved questions are in [../product/decisions-log.md](../product/decisions-log.md) and open items in [../product/backlog.md](../product/backlog.md).

- **Decided** (founder, 2026-10-19): the minimum is 5 USD or a fixed equivalent, and smaller balances carry forward with no limit.
- **Decided** (founder, 2026-10-19): no creator attestation of revenue on BYO providers. Signed provider data and the daily reconciliation are enough.
- **Pre launch accounting task** (founder, 2026-10-19): tax on platform fee invoices is deferred until the Cloud Edition has revenue. Before Cloud revenue, an accountant decides whether the fee carries VAT or sales tax by creator location, and cohory registers where needed (human gate). Until then invoices carry no tax.
