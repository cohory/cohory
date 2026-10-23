# 0034. New notification types, grouped notices, failed payment emails, and a weekly digest

Owners hear about joins, money events, and reports; members hear about likes and failed payments; and every member gets one weekly digest email unless they turn it off.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: founder (weekly digest approved as MVP scope; a founder decision keeps Stripe's invoice and receipt emails), coordinator as product owner for the details
- Related: [../product/information-architecture.md](../product/information-architecture.md) section 10, [../architecture/payments.md](../architecture/payments.md), [0028](0028-stripe-disputes.md), [0030](0030-payment-webhooks-in-the-worker.md)

## Context

The member pages review found that owners were not told when someone joined, that likes left no trace in the bell, that a member whose renewal failed got no email from cohory, that the bell showed 20 items with no way to see more and no preview, and that nothing brought a quiet member back once a week. The manage pages review found that nobody was told about a new report or about money events (a new paying member, a cancellation, a failed payment). The emails review listed the missing failed payment, digest, new member, and ownership emails.

Notifications so far were one row per event. Likes and reports would flood the bell that way, and a weekly email per community would flood the inbox of a member of several communities.

## Decision

1. **New types.** `member_joined` (owner and admins; email in the daily summary by default), `like_on_post` and `like_on_comment` (the author; in the app only by default), `report_created` (owner, admins, and moderators except the reporter; in the app only by default), `paid_member_joined` and `paid_member_canceled` (owner, in the app), `member_payment_failed` (owner, in the app, first attempt only), and `event_created` and `event_reminder` (render and preference entries only, for the calendar unit to emit). Every type has a row in Account, Notifications.
2. **Grouped notices.** Likes group per post or comment ("Ana and 4 others liked your post"), joins per community, and reports per community per hour ("3 new reports are waiting for review"). A group stays open while it is unread and has not been emailed; reading it or emailing it starts a new one. A repeated event from the same person does not count twice.
3. **Money events come from Payments.** Payments appends `payments.paid_member_joined`, `payments.paid_member_canceled`, and `payments.member_payment_failed` to the outbox when the subscription mirror changes or `invoice.payment_failed` arrives. A subscription linked from before cohory does not count as a new paying member. A cancellation counts once, when the subscription is set to end at the period end. A paid join gives the owner one notice with the price ("Sam joined and pays $49.00/month") and no separate `member_joined` notice. A failed payment counts only while the invoice is still open with an amount due, so a late event for an invoice that was paid in the meantime is ignored.
4. **Failed payment emails.** The member gets an email and an in-app notice for Stripe's first three attempts on an invoice, each with the amount and the next retry date, only while the subscription still grants access. The notice id is derived from the invoice and the attempt, so a repeated webhook does not send twice. The email links to the Membership page, where "Manage billing" opens the Stripe customer portal. Creators should turn off Stripe's own customer email about failed card payments (in the Billing settings of their Stripe Dashboard, under the customer emails for failed payments) so members do not get two emails. Stripe's invoice and receipt emails stay on (founder decision, 2026-10-22).
5. **Ownership transfer email.** The new owner gets one email that says new checkouts are paused until they choose a Stripe account, with a link to Manage, Payments.
6. **Weekly digest.** One email per member on Monday at the member's digest hour in their time zone, combining every community that had at least 2 new posts in the last 7 days. Per community it shows the counts of new posts and new members, the top 3 posts of the week with their first line and comment count, up to 3 new member names, the next 2 events in the coming week, and the member's next lesson. Owners also see new paying members and cancellations of the week. The subject is "[{community}] This week: {top post title}" for one community and "This week in your communities" for several. It is on by default, off with a switch in Account, Notifications or the one click unsubscribe link (scope `weekly`), and it is never sent twice within 6 days: the job takes a per member lock, checks `last_weekly_digest_at` again, sends, and only then writes it, so a failed send is tried again on the next run within the hour. Before reading a community the job asks Entitlements whether the member still has access; a community the member cannot read (for example, paid access that lapsed) is left out and the rest of the digest is still sent. Top posts are limited to posts from the digest week. Within one run the feed of a community is read once per role and its new members once per community.
7. **Bell depth.** The bell loads 20 items and offers "Show older notifications" with the cursor. Mentions, replies, and comments show the first line of the comment or post (at most 140 characters), carried in the posts events. Deleting the comment or post, or removing it after a report, clears the preview. A preview is stored only for a recipient who has access to the community's content at the time of the fanout (Entitlements decides), so a member whose paid access lapsed sees the notice without the text.
8. **Links.** Join and money notices open Manage, People; report notices open the Reports tab; event notices open the calendar.

## Alternatives considered

- **One weekly email per community.** Simpler to build, but a member of five communities would get five emails each Monday. Rejected.
- **A digest that runs at a fixed UTC hour.** Rejected: members already choose the hour of the daily summary, so the weekly digest uses it.
- **Reading the comment text at display time for previews.** Rejected: notifications may not read the comments table (module boundary and row level security). The preview travels in the event instead, and deletions clear it.
- **Emailing every failed attempt.** Rejected: Stripe can retry up to eight times. Three emails cover the usual retry window without nagging.

## Consequences

- A preview is a copy of the first line at the time of posting. Editing the comment does not update it.
- Grouped report counts can count one report twice when a fanout job retries after a later report joined the group. The count is a hint; the Reports tab is the source of truth.
- Grouped counts are not yet idempotent: storing which events a group already counted needs a new column, which this change does not add.
- The digest writes `last_weekly_digest_at` after the send. If that write fails after the email went out, the next run within the hour sends the digest again. This is rare and preferred to losing a digest.
- Members with the same role in a community see the same top posts in one run, read as the first of them the job reaches. Access is still checked per member.
- Likes, comments, and mentions reach the bell after the worker next checks the fanout queue, every 2 seconds by default (`WORKER_FANOUT_POLL_SECONDS`).
- Card brand and last four digits are not in the failed payment email, because the invoice event does not carry them.
- The digest scans users in pages every 15 minutes and calls the posts, calendar, and courses services as the member, so it only shows what the member may read.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | The weekly digest is MVP scope, on by default (founder). |
| Confirmed | Stripe's invoice and receipt emails are kept; cohory does not duplicate them (founder decision, 2026-10-22). |
| Recommendation | Three failed payment emails per invoice, tied to Stripe's attempts. |
| Recommendation | Monday at the member's digest hour; skipped when a community had fewer than 2 new posts. |
| Open question | Whether creators can turn the digest off for their community. |
| Open question | Making grouped counts idempotent, which needs a migration. |
