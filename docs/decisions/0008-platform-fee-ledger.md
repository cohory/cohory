# 0008. Platform fee ledger

Record every Cloud platform fee, fee refund, and adjustment as an append-only ledger entry, whatever the payment provider, and bill ledger balances monthly when a provider cannot split fees.

- ADR status: Accepted (ledger concept and periodic billing are Confirmed). Billing parameters are Proposed.
- Date: 2026-10-17
- Deciders: founder (ledger, periodic billing), foundation docs wave (billing parameters)
- Related: [../architecture/payments.md](../architecture/payments.md) sections 7 to 9, [../foundation/business-model.md](../foundation/business-model.md)

## Context

**Confirmed:** with BYO payment providers that cannot split fees, Cohory records the 2% in a financial ledger and collects it through periodic platform billing. Providers do not share capabilities. Every path writes to the fee ledger, which is the single source of truth for platform revenue. REQ-PAY-004 requires append-only entries reconciled daily against Stripe.

Fee rules (base, rounding half up in integer minor units, no minimum, proportional refunds, refunds on lost disputes) are defined in business-model.md.

## Decision

- Table `fee_ledger_entries`, append-only, enforced by database grants. Kinds: `fee_accrued`, `fee_collected`, `fee_refunded`, `adjustment`, `invoice_settled`.
- Each entry stores base, currency, rate in basis points (100), Cohory's computed fee, the provider's reported fee, provider references, and a unique idempotency key derived from provider ids.
- One pure fee function computes all fees. When Stripe computes the fee, Stripe's amount is authoritative and both values are kept; differences above one minor unit alert.
- Daily reconciliation against provider data.
- Monthly billing for accrued balances (post-MVP): calendar month, rollover below $10 for up to three periods, invoice on Cohory's own Stripe account, reminders at 7 and 14 days, new paid signups paused after 30 days unpaid, existing members and exports unaffected.
- Community Edition writes no fee entries.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Rely on Stripe's application fee records only | No extra table | No BYO support, no own audit trail, no reconciliation | Brief requires a provider-independent ledger. |
| Mutable fee records | Simpler corrections | Loses history, hard to audit | Money records must be append-only. |
| Usage-based billing through a third-party billing tool | Off-the-shelf invoicing | Another vendor, data outside our ledger | Not needed for one monthly invoice per community. |

## Consequences

- Positive: one auditable record of what Cohory earned, provider-independent, with alerts on mismatch.
- Negative: reconciliation jobs and their alerts must be maintained.
- Negative: BYO revenue depends on provider reporting we do not control.
- Follow-up: fee function with property tests, reconciliation job, ledger view in Manage, Payments.

## Open questions

- Verification of revenue reported by BYO providers.
- Tax on the platform fee itself (business-model.md).
