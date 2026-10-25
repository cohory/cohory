# 0042. Moving paying members: no linking on Cloud, free time until the old renewal date, and a list of who still needs to move

Cloud no longer offers to link existing Stripe subscriptions. Members who paid somewhere else start a new subscription with a free period that ends at their old renewal date, and the creator sees who has moved.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: founder (founder decision, 2026-10-22), coordinator as product owner for the rest
- Related: [../operations/payment-migration.md](../operations/payment-migration.md), [../architecture/payments.md](../architecture/payments.md) section 10.1, [../architecture/data-model.md](../architecture/data-model.md) section 9.1 (`subscriber_moves`)

## Context

Cloud onboarding always creates a new Stripe connected account, so it never holds a creator's existing subscriptions. The "Bring your existing subscribers" card still promised to link them. Members who had to subscribe again were asked to pay at once while their old subscription still ran, so each paid twice for the overlap unless the creator refunded by hand. Skool and Circle exports say who was paying, but the importers dropped those columns, and archive imports gave paying members free access with no end date.

## Decision

1. **Linking only where it can work.** `PaymentsEnv.subscriptionLinking` is true on the Community Edition and false on Cloud. `discoverSubscriptions`, `linkSubscriptions`, and `claimInvitedSubscriptions` refuse with `edition_mismatch` when it is false, after the permission check. The web pages show the moving flow instead of linking on Cloud. The Connect specific linking code (platform fee on linked subscriptions) stays, tested with linking switched on, for the day Cloud can attach an account that already holds subscriptions; that needs a new decision record.
2. **Moving offers.** A row in `subscriber_moves` (community, email, free until date, status `pending` or `resubscribed`) is a moving offer. Owners and admins (`payment.link_subscriptions`) add rows by pasting addresses with an optional date, or with one click from the last Skool, Circle, or archive import. Saving the same email again updates the date of a pending row and never touches a moved one. Free time can last up to two years, the longest trial Stripe allows. A paste holds up to 1,000 people and a community up to 5,000.
3. **Free time at Checkout.** When the signed in member's email has a pending move with a future date, Checkout sends `trial_end` at that date (the same 48 hour minimum as the linked subscription resubscribe path, otherwise it charges at once). A pending move also lets a member who already has free access (an imported active membership or a comp) start a subscription, and the membership page shows "Subscribe again" with the date. When the server requires confirmed emails, an unconfirmed account gets no free time. Without SMTP nothing can be confirmed, so whoever signs up first with a listed address gets the free time; the self-hosting guide says so.
4. **Tracking.** When the webhook worker records any subscription for that member in that community, even an incomplete one, it marks the move `resubscribed` with the subscription id, so the free time is used once. This is idempotent and never undone, so repeated or out of order events do not matter. The list shows Not moved yet, Moved (cancel their old subscription), or Free time ended.
5. **Reminder email.** "Email everyone not moved yet" sends the `moving-offer` email ("You won't be charged until {date}. Cancel your old subscription on {platform} now") to pending people, at most once every 7 days each, and only until 7 days after the free time ends (30 days after the row was added when it has no date). Only an owner or admin session can send it. The claim locks rows with `FOR UPDATE SKIP LOCKED` and repeats its conditions in the update, so two clicks at once never email a person twice. It replaces the email template creators had to copy.
6. **Imports.** Skool's Price and Tier columns and a Circle paywall column set a "was paying" flag that the import report keeps (`report.paying`). Archive imports end the comp for a paying member at the old `currentPeriodEnd`, or 7 days after the restore when that date has passed, instead of never. "Add them to the list" uses the same date.
7. **Invitation links.** Free access and "Your membership has moved" emails open the membership page, which shows Sign in and Create an account (when sign up is open) to signed out visitors and returns them there.
8. **Free memberships end on the Community Edition.** Adding a person with a date to the list, when they are a plain member of a paid community with no granting subscription and no comp, grants a comp that ends at that date (at least 7 days ahead). The comp expiry job then removes the membership unless they subscribed. Pasting the person again moves that comp's end to the new date, later or earlier, but never sooner than 7 days ahead, with a `comp.expiry_changed` audit entry. Rows without a date (Skool exports have none) keep access and show "No renewal date". Cloud leaves free memberships open. Pastes in one community take a transaction advisory lock, so two at once cannot pass the 5,000 cap.
9. **Retention.** A daily job, which works through the communities in batches of 500 per transaction because the policy needs one community scope at a time, deletes a row 90 days after its free time ends or the member moved, and 120 days after it was added when it has no date. Account erasure deletes the rows matching the person's email in each community they belong to and replaces the email on their subscription links with an `@erased.invalid` address. The table's row level security needs a community scope, so neither can find rows by email across communities; a row for an address that never joined waits for the retention job.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep the linking card on Cloud with a warning | No code change | Promises something Cloud cannot do | Decision 6 |
| Import moves automatically in the import job | No extra click | The migration worker would write a payments table across the module boundary | One click from the import keeps the boundary and lets the creator check the list |
| A Stripe coupon instead of a trial | Works for any start date | Discounts the first invoice instead of delaying it, and coupons are per price | A trial matches "free until the old renewal date" exactly |

## Consequences

- Cloud creators see one honest path: move paying members with free time.
- Members pay once: the old platform until its renewal date, then Cohory.
- On Cloud, imported active members in a paid community keep free access until they subscribe, as before. On the Community Edition a dated move ends that access at the date.
- Moving offers are personal data with a bounded life: a row without a date lives up to 120 days, and a dated row lives until 90 days after its date or the move. Dates can be up to two years ahead, so a dated row can live about two years and three months.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Cloud does not offer linking existing subscriptions (founder decision, 2026-10-22). |
| Recommendation | Moving offers, free time at Checkout, tracking, and the reminder email as above. |
| Unverified | The Circle paywall column name. The importer reads Paywalls, Paywall, Plan, Plans, Subscription, or Subscriptions. |
| Open question | Whether Cloud should support connecting an existing Stripe account (OAuth or Accounts v2), which would bring linking back. |
| Recommendation | Imported free memberships end at a dated move's date on the Community Edition only (review of r43). |
| Open question | Whether Cloud should end imported free memberships at a date too. |
| Open question | An `app.account_purge` policy on `subscriber_moves` keyed by email would let erasure reach communities the person never joined; it needs a migration. |
