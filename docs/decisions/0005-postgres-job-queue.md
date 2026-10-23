# 0005. pg-boss job queue by default, BullMQ optional

Run background jobs on PostgreSQL with pg-boss by default and switch to BullMQ on Redis when `REDIS_URL` is set.

- ADR status: Proposed
- Date: 2026-10-17
- Deciders: founder (to confirm, since the brief and notes name Redis + BullMQ), architecture docs wave
- Related: [../architecture/overview.md](../architecture/overview.md) sections 7 to 9 and 12

## Context

The founder's notes and the brief list Redis + BullMQ for background jobs. Other requirements pull toward fewer services: self-hosting on 2 vCPU and 4 GB (REQ-NFR-HOST-001, 002), install in under 30 minutes (REQ-NFR-HOST-003), and no required external services. Research found hosted queues hurt self-hosting and that Documenso offers a database-backed queue with BullMQ as an option.

Expected job volume is modest: emails, reminders, webhook processing, reconciliation, exports.

## Decision

- A `Queue` interface in `packages/infra` with two adapters: pg-boss (default) and BullMQ (when `REDIS_URL` is set).
- Domain events go through an outbox table, so event dispatch works the same with either adapter.
- All handlers are idempotent, carry `community_id`, and receive ids rather than objects.
- Docker Compose makes Redis an optional profile.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| BullMQ + Redis only (founder default) | Mature, fast, good tooling | Redis required for every install, one more service to back up and secure | Extra burden for single-creator self-hosters. Kept as the Cloud and large install option. |
| Graphile Worker | PostgreSQL based, solid | Smaller community than pg-boss for this use, similar trade-offs | Either works. pg-boss chosen for scheduling and singleton features. Revisit if it disappoints. |
| Hosted queues (Trigger.dev, Inngest, QStash) | No ops | Breaks self-hosting | Contradicts principle. |
| In-process timers | Zero setup | Lost on restart, no retries | Not reliable. |

## Consequences

- Positive: minimal self-hosted stack (web, worker, migrate, PostgreSQL). Jobs can be enqueued in the same transaction as data.
- Negative: two adapters to maintain and test. CI runs the job suite against both.
- Negative: deviates from the founder's original Redis + BullMQ default. [../product/mvp-scope.md](../product/mvp-scope.md) section 2.11 and REQ-NFR-HOST-001 already reflect this proposal and must be revisited if the ADR is rejected.
- Follow-up: queue interface, adapter tests, operator view for failed jobs.

## Open questions

- Founder confirmation of the deviation from Redis + BullMQ as default.
- Load threshold at which Cloud switches to BullMQ (proposed: from the start on Cloud).
