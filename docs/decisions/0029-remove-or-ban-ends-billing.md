# 0029. Removing or banning a paying member ends their subscription

When staff remove or ban a member who pays, cohory cancels that member's subscription at once, without proration and without a refund, and the creator sees this before confirming.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner under the founder's mandate (founder decision, 2026-10-22)
- Related: [0007](0007-stripe-connect-direct-charges.md), [0027](0027-safe-exit-and-2-percent-fee.md), [../architecture/payments.md](../architecture/payments.md), [../foundation/product-requirements.md](../foundation/product-requirements.md) (REQ-MEM-003)

## Context

Remove and ban only changed the membership status. A paying member who was removed or banned lost access but kept being charged, because nothing touched their Stripe subscription. Charging someone who was thrown out is the fastest way to a dispute (manage pages review, 2026-10-21). REQ-MEM-003 and the payments architecture said removing asks whether to cancel and banning cancels at period end, which was never built.

## Decision

1. Removing or banning a member cancels every subscription that still grants them access in that community immediately (`prorate: false`, `invoice_now: false`). No refund is issued; a creator who wants to refund does it in their Stripe dashboard.
2. The Remove and Ban dialogs in Manage, People and the ban dialog in the report queue read the member's billing first and say "{name} pays {amount} per {interval}. Their subscription ends now with no refund." When the price is not known (a linked subscription without a plan) they say "{name} pays for a subscription. It ends now with no refund."
3. Leaving on your own keeps the existing flow from founder decision R1: leaving does not cancel billing.
4. Communities never writes Payments tables. After its membership transaction commits, it hands the domain event `membership.removed_by_staff { communityId, userId, kind }` to the Payments service (`requestBillingEndForRemovedMember`), which queues the pg-boss job `payments.member-billing-end` with 8 retries and backoff. The worker runs `endBillingForRemovedMember`. Payments cancels only while the membership is banned or removed by staff, uses the idempotency key `staff-removal:{subscription id}`, and marks the mirrored subscription revoked, so duplicate delivery and retries are safe. If the job cannot be queued, the request ends billing itself, as exit runs do.
5. Moderators see the billing line too. They can remove and ban, the plan price is public on the About page, and the read is limited to `membership.manage` (staff).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Cancel at period end | Member keeps what they paid for | A removed member cannot use the rest of the period anyway; billing state and access disagree | Decision 11 picks immediate cancel |
| Ask the owner each time | Flexible | One more choice in a moderation moment; easy to leave billing running by mistake | Decision 11 makes it automatic and visible |
| Refund the unused part | Generous | Takes money from the creator without their choice | Refunds stay a creator action in Stripe |
| Call Stripe in the request after the commit | No queue | A Stripe failure leaves the member removed and still billed, and remove cannot be retried; the report queue ban would call Stripe inside the Posts transaction | A retried job instead |

## Consequences

- Positive: no one is charged after staff remove or ban them, and the creator knows before confirming.
- Positive: a Stripe outage delays the cancel instead of losing it; pg-boss retries the job, and agents using the API or MCP need no recovery step.
- Negative: the cancel is asynchronous. For a short time after the dialog closes, Stripe may still show the subscription as active.
