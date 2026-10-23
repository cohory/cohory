# 0013. Domain event dispatch

Post events go to one pg-boss queue per consuming module, chosen by a routing table in `@cohory/events`.

Status: Draft, 2026-10-19

- ADR status: Proposed
- Date: 2026-10-18
- Deciders: engineering (0.1.0)
- Related: [0005](0005-postgres-job-queue.md), [0014](0014-transactional-outbox.md) (replaces the after commit publish described here with an outbox), [../architecture/overview.md](../architecture/overview.md) section 3, [../architecture/data-model.md](../architecture/data-model.md) section 8, REQ-GAM-001

## Context

Until now the posts service handed its events (`post.created`, `comment.created`, `mention.created`, `like.added`) to an `onEvents` hook, and `@cohory/notifications` turned each write into one `notifications.fanout` job. Gamification needs the like events too, plus two it could not get: an unlike and the removal of liked content (mvp-scope 2.7 says unlike or deletion removes the point). AGENTS.md section 2 asks for cross-module side effects to go through an event or a job rather than a shared transaction.

Two facts shaped the choice:

1. Notifications and gamification fail and retry independently. A bug in point accounting must not resend notifications, and the reverse.
2. The publisher used a 60 second singleton key per subject and liker. A like, an unlike, and a like again inside a minute would drop the second like, which is harmless for notifications and wrong for points.

## Decision

- A new package `@cohory/events` owns the Zod schema of post events (`postEventSchema`, `postEventsJobPayloadSchema`) and the publisher (`createPostEventsPublisher`, `publishPostEventsAfterCommit`).
- The publisher keeps a routing table, `postEventRoutes`: each entry names a queue and the event types it accepts. Today `notifications.fanout` accepts the three created events and `like.added`; `gamification.points` accepts `like.added`, `like.removed`, `post.deleted`, and `comment.deleted`. One write sends at most one job per queue.
- Like events carry the reaction id and the time of the change. Singleton keys use the reaction id, so a new like after an unlike is never deduplicated away.
- `post.deleted` and `comment.deleted` carry the likes that stop counting (reaction id, subject author, liker), read by the posts module before the soft delete. Deleting a post also covers likes on its live comments; deleting a comment covers its replies. The gamification module never reads the posts tables.
- Points handlers are idempotent through the ledger: one row per reaction and reason, and at most one reversal per reaction. Replaying a job or receiving `like.removed` and `post.deleted` for the same reaction changes nothing the second time. Entries apply in any order because each is a signed delta.
- `@cohory/notifications` re-exports the publisher under its old names, so existing callers (`apps/web/lib/posts/service.ts`, `packages/api/src/app.ts`) send to both queues without changes.
- Points for deleted content are handled now rather than deferred, because the event already has to exist for unlikes and the extra code is one repository query per delete.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| One generic `events.dispatch` job that calls every consumer | One job per write, one place to add consumers | A failing consumer retries all consumers, so both must be idempotent against each other's retries; one slow consumer delays the others | Couples failure and retry across modules |
| pg-boss publish and subscribe | Built into pg-boss | Subscriptions live in the database and are created by the worker, so events published before the worker first starts are lost; harder to test without a database | Startup ordering risk for little gain at two consumers |
| Gamification calls from the posts transaction | Points always consistent with likes | Couples two modules' writes, against AGENTS.md section 2 | Not needed: the ledger can be rebuilt and replays are safe |
| Transactional outbox table (ADR 0005) | No lost events when the queue is down after commit | New table and relay process | Still the long term plan; this ADR keeps the after commit publish from the posts module and only changes routing |

## Consequences

- Positive: each module retries on its own queue; adding a consumer is one routing entry and one worker registration.
- Positive: deletion events make point totals match mvp-scope 2.7 without the gamification module reading posts tables.
- Negative: the routing table names consumer queues in a shared package, so adding a consumer edits `@cohory/events`.
- Negative: events are still published after commit. If enqueueing fails the write succeeds, the failure is logged, and points drift until `recomputeMemberStats` or a replay. The outbox from ADR 0005 closes this gap.
- Follow-up: a large post deletion sends every removed like in one payload; batch it if posts with thousands of likes appear.

## Open questions

- Whether points should keep accruing while a creator has gamification turned off (current behavior: yes, only reads are hidden). Owner: product.
