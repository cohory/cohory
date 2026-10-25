# 0051. Payment decisions made in 0.2.0 and 0.5.0 that had no record

Six payment decisions were made while building 0.2.0 and 0.5.0 and documented only in the architecture doc. This record writes them down so they can be accepted or changed like every other decision.

- ADR status: Accepted (founder, 2026-10-25)
- Date: 2026-10-25
- Deciders: founder (2026-10-25); the decisions were taken by the build coordinator as product owner in 0.2.0 and 0.5.0
- Related: [0007](0007-stripe-connect-direct-charges.md), [0008](0008-platform-fee-ledger.md), [0027](0027-safe-exit-and-2-percent-fee.md), [../architecture/payments.md](../architecture/payments.md) sections 8, 9, and 12, [../operations/payment-providers.md](../operations/payment-providers.md), [../operations/platform-billing.md](../operations/platform-billing.md)

## Context

[payments.md](../architecture/payments.md) section 13 lists six rows labeled "Decided (0.2.0 or 0.5.0, no decision record)". Each changed a public contract or touched money, which section 8 of [AGENTS.md](../../AGENTS.md) says needs a record. The code and the docs already follow them. This record does not change behavior; it closes the documentation gap.

## Decision

1. **Stripe Connect accounts use Accounts v2** with the full dashboard and Stripe as the collector of fees and losses. The Stripe sandbox refuses v1 `type` accounts and platform side loss liability, so there is no v1 path (payments.md section 2).
2. **Polar is the first bring your own provider**, offered on both editions, chosen as the first provider named in the research that fits memberships and has a public sandbox. [0027](0027-safe-exit-and-2-percent-fee.md) later switched it off by default (`COHORY_ENABLE_POLAR`) because Polar's acceptable use policy excludes community access; the adapter stays in the code behind that switch.
3. **Providers that cannot split a fee accrue it.** Cloud records `fee_accrued` ledger rows for such providers and bills them monthly through platform invoices (payments.md section 8.4, [platform-billing](../operations/platform-billing.md)).
4. **The accrued fee base is the amount paid minus tax stated separately.** Stripe Connect still records `fee_collected` on the charge amount, because Stripe computes that fee itself and its amount is authoritative.
5. **Each bring your own connection has its own webhook URL and secret.** Deliveries arrive at `/api/webhooks/payments/{connectionId}` with a signing secret pasted from the provider dashboard and stored encrypted like own keys.
6. **Checkouts on Stripe Connect and own keys are not paused while a platform invoice is past due.** Only providers whose fee is billed monthly pause new checkouts ([decisions-log](../product/decisions-log.md) E-20).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Leave the decisions as rows in payments.md | No extra file | Breaks the rule that money decisions have a record; nothing to accept or supersede | Rejected |
| Fold them into 0007 and 0008 | Fewer records | Accepted records are not edited beyond status and links | Rejected |
| Remove the Polar adapter now that it is off by default | Less code | A founder decision in 0027 kept it behind a switch | Out of scope here |

## Consequences

- The six rows in payments.md section 13 and the Polar note in payment-providers.md point here instead of saying "no decision record".
- Accepting this record confirms behavior that already ships; rejecting any item means a code change and a new record.

## Open questions

- Whether the founder confirms all six items as they stand, or changes the accrued fee base (item 4) to the full charge amount so both ledger kinds use one base.
