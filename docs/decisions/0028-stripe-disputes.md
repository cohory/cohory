# 0028. Stripe disputes: notify, mark disputed, refund the fee on a loss

When a member disputes a payment, Cohory records the dispute on the payment, tells the owner, leaves access alone, and refunds the platform fee on the disputed amount if the creator loses.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner under the founder's mandate (founder decision, 2026-10-22)
- Related: [0007](0007-stripe-connect-direct-charges.md), [0027](0027-safe-exit-and-2-percent-fee.md), [../architecture/payments.md](../architecture/payments.md) sections 6 and 13.5, [../foundation/business-model.md](../foundation/business-model.md) section 5

## Context

`charge.dispute.*` and `radar.early_fraud_warning.created` fell through the Stripe adapter as unhandled events (Stripe review, 2026-10-21). Nothing was recorded, the owner was not told, and on a lost dispute Cohory kept its platform fee, which breaks the rule in business-model section 5. On direct charges Stripe debits the disputed amount from the creator's account and does not return the application fee by itself. The fee module also had no dispute function and no tests for zero and three decimal currencies.

## Decision

1. Every `charge.dispute.*` event (`created`, `updated`, `closed`, `funds_withdrawn`, `funds_reinstated`) fetches the dispute and its charge from Stripe and acts on the current state, so duplicate and out of order events converge. The inbox still deduplicates by event id.
2. Dispute state lives on the payment: `payments.dispute_status` (`open`, `won`, `lost`) and `payments.disputed_at`. Stripe's `lost` maps to `lost`; `won`, `warning_closed`, and `prevented` map to `won`; every other status maps to `open`. A late `open` never reopens a closed dispute.
3. The first time a payment is marked disputed, the owner gets the notice `payment_disputed` in app and by email, through the existing paid membership outbox topic and worker job. It links to Stripe's disputes page and says the member keeps access.
4. A dispute never revokes access. Access keeps following subscription events only.
5. On a lost dispute on Stripe Connect, the pure fee module function `disputeFeeRefundDue` computes the fee share of the disputed amount on top of earlier refunds, minus what the fee already returned. Cohory refunds that amount with idempotency key `fee-refund:dispute:{disputeId}` and tags the Stripe fee refund with metadata `cohory_dispute_id`. The ledger records it as `fee_refunded` with the new column `reason = dispute_lost`, keyed by the Stripe fee refund id, so the dispute handler and `application_fee.refunded` write the same single entry.
6. Early fraud warnings are logged with the charge id and change nothing. Refunding is the creator's choice in Stripe.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A new ledger kind `fee_dispute_refunded` | The kind says it all | Every sum, sign check, and billing query that knows `fee_refunded` needs a second kind | A reason column keeps the totals unchanged |
| A `payment_disputes` table | Several disputes per payment, full history | New tenant table, RLS, and repository for one row per charge; Stripe allows one dispute per charge | Two columns on `payments` are enough |
| Revoke access when a dispute opens | Stops a member who charged back | Many disputes are mistakes or fraud on the card holder; decision 12 says no | Creators can remove the member themselves |
| Only write the ledger entry, no Stripe fee refund | No Stripe write | The creator would not get the money back on Connect | The fee must be returned for real |

## Consequences

- Migration 0033 adds two nullable columns on `payments`, a nullable `reason` on `fee_ledger_entries` (only allowed on `fee_refunded`), the enums `payment_dispute_status` and `fee_ledger_reason`, and the notification type `payment_disputed`. No new table, so row level security is unchanged.
- The Connect webhook destination must send the `charge.dispute.*` events and `radar.early_fraud_warning.created`.
- `StripeGateway` gains `retrieveDispute`, and `refundApplicationFee` takes a dispute id or null.
- Disputes on a connection that has already left Cloud are ignored like other events on a disconnected connection. Fees created after exit are refunded in full anyway (13.8).
- A dispute on a payment Cohory never recorded is logged; the fee is still refunded when lost, without a payment link.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Product decision 12: notify, mark disputed, refund the fee on a loss, no automatic access change. |
| Recommendation | Dispute state as two columns on `payments` and a `reason` on the ledger. |
| Open question | Whether Stripe ever returns the application fee on a lost direct charge dispute by itself. The handler refunds only what is still owed, so it stays correct either way. A Stripe test mode run is a human gate. |
| Open question | Whether a lost dispute on a connection that has since left Cloud should refund the fee on a charge from before the exit. |
