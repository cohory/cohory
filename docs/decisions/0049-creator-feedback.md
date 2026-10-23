# 0049. Creator feedback on the Cloud Edition

The Cloud Edition asks community owners one short question after their first post, first paid member, and first course, and offers an optional reason when they archive, delete, disconnect Stripe, or delete their account. Answers are stored per person and emailed to the operator.

- ADR status: Proposed
- Date: 2026-10-23
- Deciders: founder (what to ask and when), coordinator as product owner for the details
- Related: [0048](0048-creators-community-invitation.md), [0027](0027-safe-exit-and-2-percent-fee.md), [0033](0033-platform-config-and-neutral-home.md), [0039](0039-legal-pages-and-data-rights.md), [../architecture/multi-tenancy.md](../architecture/multi-tenancy.md), [../architecture/data-model.md](../architecture/data-model.md) section 14.4

## Context

The Cloud operator has no signal on where creators struggle or why they leave. A survey tool would be a hosted dependency and would see personal data. The founder asked for a few questions inside the product, never blocking, at most one a month, and easy to turn off. Self-hosted servers must not collect anything for anyone.

## Decision

1. **Cloud only.** The service is built with the edition; on the Community Edition `recordMoment` returns `unavailable`, `nextQuestion` returns null, exit reasons are dropped, and no outbox job is queued (`createFeedbackMomentsPublisher` checks `parseEdition()`).
2. **Moments come from events.** `post.created`, `subscription.activated`, and `course.published` (written by the courses service on the `course_events` topic, [0048](0048-creators-community-invitation.md)) go through the existing outbox. The outbox relay queues a `feedback.moments` job with a singleton key per community and moment. The worker asks the owning module whether this is the first one (`countPublishedPosts`, `countActivatedSubscriptions`, `countPublishedCourses`; exactly one counts as first) and records a pending row for the active owner. No module calls the feedback service inside its own transaction.
3. **Asking.** The feed and Manage layout render one card for the owner on the next load: the oldest pending moment in that community, if the person has not opted out, has not answered or dismissed any question in the last 30 days, and the moment is under 90 days old. Send stores a 1 to 5 score and an optional comment of up to 1000 characters; Not now and the close button end that moment without a score; "Don't ask me again" also sets `notification_settings.creator_feedback_opted_out_at`, which Account, Notifications clears. Each moment is asked once per community (partial unique index).
4. **Exit reasons.** Archive, delete community, disconnect Stripe, and delete account show an optional reason (Too expensive, Missing a feature I need, Too hard to use, Moving to another platform, Not enough members or activity, Only testing, Other) and comment. The action runs first or regardless; `recordExitQuietly` logs and drops any failure, so a reason never blocks or fails the action.
5. **Authorization.** `creator_feedback.answer` is owner only and checked in the service for every community scoped read and write; deleting the account needs only the signed in person. It is non grantable and forbidden to agents.
6. **Tenancy.** `creator_feedback` belongs to the person. Forced RLS keys on `user_id = app.user_id`; a write must have no community or the community in `app.community_id`. `community_id` is nullable with `on delete set null`, so feedback outlives a deleted community. A community archive or export never includes the rows; the person's own account data export does (`feedback.json`, and the opt out in `profile.json`). A second policy behind `app.feedback_retention = 'on'` admits only rows older than 24 months, for the daily `feedback.retention` job.
7. **Delivery.** Each answer and reason is queued through the email outbox to `CONTACT_EMAIL` with the template `creator-feedback`, subject `[{instance} feedback] {topic}: {score or reason}`, carrying the user id, community slug, edition, and instance address, never an email address, name, or token. Without `CONTACT_EMAIL` or a working email driver the row is stored and nothing is sent.
8. **Retention and erasure.** Rows are kept for 24 months (Recommendation) and deleted with the account by the account purge. The Cloud Privacy Policy says so.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A hosted survey tool | No code | A hosted dependency and a processor for personal data | AGENTS.md section 12 |
| A modal after each moment | Higher answer rate | Interrupts the creator at the moment they succeed | The brief asks for a dismissible card |
| A community scoped table | Matches other tables | The answer belongs to the person, and must survive the community and stay out of its export | User owned row with an optional community |
| A required reason before archive or delete | Complete data | Blocks safe exit and pressures the creator | Optional, recorded after the action |
| Counting firsts inside each module's write | No extra job | Couples transactions across modules | Domain events and the owning modules' count functions |

## Consequences

- Positive: the operator learns where setup is hard and why creators leave, without a third party.
- Positive: self-hosted servers collect nothing.
- Negative: firstness is checked after the fact, so a post that is deleted before the job runs can leave the moment unasked.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Cloud only, at most one question in 30 days, each moment once per community, opt out reversible in Account (founder brief, 2026-10-23). |
| Recommendation | 24 month retention; pending moments expire after 90 days; Not now ends the moment. |
| Confirmed | The account data export includes the person's feedback rows and opt out; community archives do not (coordinator, 2026-10-23). |
