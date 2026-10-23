# 0014. Transactional outbox for domain events

Domain events are written to an `outbox` table in the same transaction as the write that caused them, and a relay moves them to pg-boss.

- ADR status: Accepted
- Date: 2026-10-18
- Deciders: engineering (proposed and accepted for 0.1.0 under a delegation from the founder)
- Related: [0005](0005-postgres-job-queue.md), [0006](0006-shared-database-multi-tenancy.md), [0013](0013-domain-event-dispatch.md), [../architecture/data-model.md](../architecture/data-model.md), [../architecture/overview.md](../architecture/overview.md)

## Context

[0013](0013-domain-event-dispatch.md) publishes post events to pg-boss after the posts transaction commits. When enqueueing fails (database restart, pool exhausted, a crash between commit and send) the write succeeds and the events are lost: notifications are never sent and points drift until `recomputeMemberStats` runs. The posts module recorded this as a known gap and Step 8 was asked to close it.

Constraints:

1. Self hosting must not need Redis or another service (0005). The fix has to live in PostgreSQL.
2. Tenant tables use forced row level security (0006). The relay reads rows of every community.
3. Consumers already exist (`notifications.fanout`, `gamification.points`) and must not change.
4. Notifications should still arrive within a second or two of the write.

## Decision

- A new table `outbox` (migration 0011): `id` (UUIDv7), `community_id` (nullable, foreign key with cascade, for future platform events), `topic`, `payload` (jsonb), `attempts`, `last_error`, `published_at`, `created_at`. A partial index on unpublished rows serves the relay, and an index that starts with `community_id` serves tenant scoped reads.
- Row level security is forced. Inserting needs the row's `community_id` to match `app.community_id`, or a null `community_id`. Reading, updating, and deleting need `app.outbox_relay = 'on'`, which only the relay sets inside its own transaction. Request code can append but never read the outbox.
- `@cohory/db` owns the table and exports `appendOutbox(tx, entry)`, so a module can write an event without depending on `@cohory/events` (which depends on `@cohory/posts` for event types).
- The posts service appends one row per write (`topic = "post_events"`, `payload = { events }`) inside the write transaction and returns the row id as `outboxId`.
- `@cohory/events` owns the relay. `relayOutbox` claims unpublished rows with `for update skip locked`, publishes each one through the topic's publisher, then sets `published_at`, or increments `attempts` and records the error name. Every pg-boss job uses the outbox row id as its job id, and pg-boss inserts jobs with `on conflict do nothing` on `(name, id)`, so a row relayed twice never creates a second job on the same queue.
- Two relay paths:
  - After commit, the web app and the API call `relayPostEventsAfterCommit`, which relays only the row just written. This keeps the old latency. Failures are logged and swallowed, the write still answers 201.
  - The worker runs `outbox.relay` every minute and sweeps every pending row, so anything the first path missed is delivered within about a minute. The same job deletes published rows older than 7 days.
- `publishPostEventsAfterCommit` is kept as a name for the after commit path, now backed by the outbox. The routing table from 0013 and the consumer handlers are unchanged.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep publish after commit (0013) | No new table | Events are lost when enqueueing fails | The gap this record closes |
| Send the pg-boss job inside the write transaction | One table, no relay | pg-boss uses its own pool, so the job is not in our transaction; sharing a connection couples every module to pg-boss internals | Not transactional with Drizzle without fragile plumbing |
| Outbox with the relay only in the worker | Simplest code path | Events wait up to a minute | Notifications must feel immediate |
| PostgreSQL `LISTEN` and `NOTIFY` to wake the relay | Low latency without polling | Notifications are lost while the worker is down, so a sweep is still needed | More moving parts for the same result |
| Logical replication or Debezium | No polling, exact ordering | Needs extra services and superuser setup | Breaks the self hosting constraint |

## Consequences

- Positive: a committed write always produces its events. Retrying relays is safe because job ids are deterministic.
- Positive: other modules (calendar, gamification, payments) can append events through `appendOutbox` with a new topic and a publisher in `@cohory/events`.
- Negative: one extra insert per write and one extra update per relay.
- Negative: events of a single row are published in order, but rows are not globally ordered. Consumers already apply events in any order (0013).
- Negative: a row that keeps failing stays pending and is retried every minute. `attempts` and `last_error` make it visible, there is no dead letter yet.
- Follow-up: expose pending outbox rows and their age in an admin health view.

## Open questions

- Whether a platform event (null `community_id`) is needed before Phase 6. The column allows it now. Owner: architecture.
