# 0025. Reviews module: tenure from Payments, standing from a membership trigger, and its own report table

The reviews module owns its tables and reads subscription facts only through a Payments service function, learns about removals and bans from a membership trigger, and keeps review reports in its own table that the existing moderation screen lists.

- ADR status: Draft
- Date: 2026-10-20
- Deciders: Step 17 unit V3 (proposed), founder to confirm
- Related: [0016](0016-database-triggers-append-domain-events.md), [0015](0015-migration-module-direct-table-access.md), [0014](0014-transactional-outbox.md), [../architecture/data-model.md](../architecture/data-model.md), [../architecture/authorization.md](../architecture/authorization.md)

## Context

The founder decided (F11 to F15, 2026-10-20) that communities can turn on member reviews. Members who have paid for at least 30 days can leave a review: an active, paid, recurring subscription to the community that has been paying continuously for at least 30 days. Role does not matter. Comped access, trials, past due subscriptions, and one time purchases do not qualify. Each review shows a status computed when it is read ("Paying member for 7 months" or "Former member"). Reviews of removed or banned members are hidden; erased accounts are anonymized. Anyone signed in can report a review into the existing moderation queue, and only the owner can hide a reported review.

Three facts live in other modules: subscription state and payment history (Payments), membership status and why it changed (Communities), and the moderation queue (Posts owns `content_reports`).

## Decision

- New package `packages/reviews` (`@cohory/reviews`) owns `reviews`, `review_replies`, and `review_reports` (migration 0027). The `reviews_enabled` flag is a `communities` column changed through the communities manage service.
- Payments exposes `listSubscriberTenure(communityId, userIds)`: per person, the subscription that grants access first, its provider status, access state, interval, origin, and `paidSince` (the first paid invoice of that subscription, or the subscription start when no invoice was mirrored; for a subscription linked from the creator's Stripe, always the day it was linked, so its first mirrored invoice does not move the date forward). Reviews never queries `subscriptions` or `payments`. The eligibility rule is one pure function in `@cohory/reviews` over those facts and an active membership.
- A membership trigger (`cohory_reviews_author_standing`, migration 0027) sets `reviews.author_removed_at` when a membership becomes `banned`, or `removed` with `app.member_removal_reason = 'removed'`, which the communities manage service now sets for staff removals. Leaving, account erasure, and a lapsed subscription keep the review. Becoming active again clears the mark. Reads skip marked reviews.
- Account erasure (`identity.account-purge`) sets `anonymized_at` on the person's reviews through a policy limited to `app.account_purge`; reads then show "Former member" with no name or picture.
- Review reports are rows in `review_reports`, not in `content_reports`. Manage, People, Reports lists them under the post and comment reports and adds their open count to the tab. Moderators and admins can dismiss them; only the owner can hide, with a reason, and only while a report is open.
- The reviews service appends `review.created`, `review.updated`, `review.deleted`, and `review.hidden` to the outbox with `cohory_append_domain_event`, and webhooks publish them. The owner notification is written by `createReviewNotifier` in `@cohory/notifications`, called after the review commits.
- Every review write is session only: the policy actions `review.create`, `review.edit`, `review.delete`, `review.report`, `review.reply`, and `review.hide` are not grantable to API or agent tokens. Reads (`review.read`) need `community:read`.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Reviews queries `subscriptions` and `payments` directly | One query | Breaks module ownership; RLS lets only the subscriber or a payments manager read those rows | Payments is the owner of money facts |
| Add a review target to `content_reports` | One table for every report | Its `post_id` is required and the posts store and views assume posts and comments; changing them couples two modules' moderation logic | A separate table keeps posts unchanged and the screen still shows one queue |
| Hide reviews of every `removed` member | No trigger | Lapsed subscriptions and leaving also set `removed`, so every "Former member" review would disappear | Contradicts F14 |
| Call the reviews service from the manage service on remove and ban | Plain TypeScript | Communities would depend on reviews, and bans also happen from the report queue, approvals, and importers | The trigger catches every path, like [0016](0016-database-triggers-append-domain-events.md) |

## Consequences

- Positive: eligibility is one tested pure function; subscription data stays behind the Payments service; every removal path hides reviews.
- Negative: one more trigger on `memberships`; staff removal must keep setting the removal reason; a linked subscription counts from the day it was linked, not from its start in the creator's Stripe, so a long time subscriber waits 30 days after linking.
- Follow-up: if archive import brings subscriptions back as paid subscriptions instead of comps, imported reviews will show "Paying member" again.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | F11 to F15 and the founder update of 2026-10-20 to the eligibility rule. |
| Recommendation | Everything in Decision above. |
| Open question | Whether a member who deletes a hidden review may post a new one at once, or only after the owner sees it. |
