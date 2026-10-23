# 0040. Member billing: the price on the membership, a fair cancel screen, and pausing payments

A paying member sees what they pay, reaches billing from inside the community, and gets one fair screen before they cancel: switch to yearly, pause payments, or cancel, with equal weight.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: product owner under the founder's mandate (the 2026-10-21 member pages review), coordinator for the details
- Related: [0030](0030-payment-webhooks-in-the-worker.md), [0031](0031-community-access-module.md), [0036](0036-about-page-that-sells.md), [0037](0037-paid-join-rules.md), [../architecture/payments.md](../architecture/payments.md), [../product/decisions-log.md](../product/decisions-log.md) rows E-33 to E-35

## Context

The member pages review found that the membership status left out the amount, that the only item in the community's "..." menu was Leave community, and that cancelling went straight to a Stripe portal whose screens depend on each creator's portal settings. Cohory showed no summary of what the member used, no cheaper yearly option, and no way to take a break. Monthly members never saw the yearly price again after they joined.

## Decision

1. **Price on the status.** The Membership page states the plan name, amount, currency, interval, and date together, for example "Makers membership. $10.00 per month. Next payment November 22, 2026.", in the active, canceling, past due, and paused states.
2. **Entry points.** The community's "..." menu has "Membership and billing" above Leave community. The account menu has Billing. Account sections show Profile, Notifications, Security, Billing, and one Developers link that opens API tokens, Agents, and Connected apps.
3. **One cancel screen.** "Cancel membership" on the Membership page opens `/c/{slug}/membership/cancel`. It shows lessons finished, events attended, posts written, the price, and the date access ends. It asks for an optional reason and comment. Three choices sit side by side with the same button style: "Switch to yearly and save X" (only when the active plan has a cheaper yearly price), "Pause payments" with 1, 2, or 3 months (only for an active monthly membership that is not already ending), and "Cancel membership". There is no second save screen.
   - Cancel sends the reason to Stripe as `cancellation_details` on the subscription, then opens the Stripe customer portal with `flow_data` of type `subscription_cancel`, which returns to the Membership page.
   - Switch to yearly opens the portal with `subscription_update_confirm` and the yearly price, so Stripe shows the proration before the member confirms.
   - Every service call checks the same rules the screen does (a pause length outside 1 to 3, a yearly or ending or past due membership, a switch without a cheaper yearly price, and resume without a pause are refused with `membership_change_unavailable`).
4. **Pause uses `pause_collection`.** Pausing sets `pause_collection.behavior = void` and `resumes_at` to the end of the paid period plus the chosen months, and stores the paid through date in subscription metadata (`cohory_paid_through`). Cohory reads a subscription with `pause_collection` as the status `paused`. Access follows the entitlements rule: a paused subscription grants access until the paid through date and ends after it, like a canceled period, so the member is removed when the period ends and restored when payments resume. "Resume payments" on the Membership page clears `pause_collection` and the metadata. Every write carries an idempotency key.
5. **Yearly at the right time.** After two paid months, the Membership page shows a quiet line: "Switch to yearly: $100.00 a year, $20.00 less than monthly." The pricing card shows "Save $20.00 a year" when the yearly price is chosen. Both amounts are exact.
6. **Checkout carries the brand.** The Stripe product gets the community logo or cover as its image, and Checkout shows "Cancel anytime from your membership page in {community}." near the pay button.
7. **Renewal reminder.** Seven days before a yearly membership renews, the member gets "[{community}] Your membership renews on {date}" with the amount for one more year and a Manage billing button. A daily job queues one email job per subscription and renewal date, with a job id derived from both, so a rerun of the day's sweep queues nothing new.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Stripe's own retention coupons in the portal | No Cohory screen | Depends on each creator's portal settings, and discounts are a dark pattern when shown only to leavers | One fair screen with the same choices for everyone |
| Pause with `keep_as_draft` | Invoices stay for the creator to collect later | Members would owe the paused months | `void` matches "not charged while paused" |
| Keep access during a pause | Friendlier | The creator gives months away for free and the access rule gets a second exception | Access ends with the paid period, like a cancel |
| A sent marker column for renewal reminders | Durable beyond the job table's retention | Needs a migration in a unit without one | The deterministic job id, kept for 30 days, covers the one day window |

## Consequences

- Positive: members see what they pay and find billing without passing Leave first. Leaving members get a real alternative and creators get the reason in their Stripe dashboard.
- Negative: the date a pause ends is kept only in Stripe; the Membership page shows it right after pausing and otherwise shows the access end date. A pause set in the Stripe dashboard is read as paused, with access through the current period end.
- Follow ups: the renewal reminder job keeps the member's email in the job row for up to 30 days; moving the lookup to send time would remove it.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Fair cancel with pause, one screen, reason sent to Stripe, no second save screen (product owner, 2026-10-22). |
| Recommendation | `void` pauses, access ending with the paid period, pauses of 1 to 3 months, monthly memberships only, the two month threshold for the yearly suggestion, and the 7 day renewal reminder. |
