# 0016. Database triggers append membership, lesson, RSVP, and subscription events

Six domain events that outbound webhooks publish are written to the outbox by PostgreSQL triggers instead of by service code.

Status: Accepted, 2026-10-19

- ADR status: Accepted (founder, 2026-10-19, as built)
- Date: 2026-10-19
- Deciders: Step 13 unit R2 (proposed), coordinator to confirm
- Related: [0014](0014-transactional-outbox.md), [0006](0006-shared-database-multi-tenancy.md), [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 6, [../architecture/overview.md](../architecture/overview.md) section 8

## Context

Outbound webhooks (REQ-AGT-007) publish `member.joined`, `member.removed`, `lesson.completed`, `event.rsvp_changed`, `subscription.activated`, and `subscription.ended`. Until Step 13 only the posts service and join requests wrote outbox rows. [0014](0014-transactional-outbox.md) expects each module to call `appendOutbox` in its own write transaction.

A membership becomes active or stops being active in at least eight places: open join, approval, invite redemption, paid checkout, comped access, member removal and bans, leaving, account erasure, and two importers. Subscription access changes in one upsert that is driven by provider webhooks and reconciliation in any order. Adding an append to every path, and keeping it there as paths are added, is easy to get wrong, and a missed path loses events silently.

Inactive member queries (REQ-MEM-008) need a last activity time per membership that posts, comments, likes, lesson progress, and RSVPs keep current, which has the same many paths problem.

## Decision

- Migration 0020 adds `cohory_append_domain_event(community_id, type, payload)`, which inserts one `outbox` row with topic `domain_events` and adds `communityId` and `occurredAt` to the payload.
- `AFTER` row triggers call it on state transitions only: memberships (`status` becomes or stops being `active`), lesson progress (`completed_at` set for the first time), RSVPs (insert or `status` change), and subscriptions (`access_state` enters or leaves `granted` or `grace`).
- Writes made by a migration import (`app.migration_manager = 'on'`) append nothing, so restoring an archive does not replay history to receivers.
- `cohory_touch_last_seen` moves `memberships.last_seen_at` forward from inserts on posts, comments, and reactions and from lesson progress and RSVP changes, at most once an hour and never backwards.
- Both functions set `app.community_id` to the row's community for their own statement and restore the previous value, so they pass the forced row level security policies even when the caller used a narrower setting.
- `@cohory/events` validates `domain_events` rows with a Zod schema and fans every published event type (from `post_events` and `domain_events`) out to the `webhooks.fanout` queue after the topic's own publisher succeeds.
- Services still append their own events where one service owns the write (posts, join requests).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Append from every service path | Matches 0014 literally, business rules stay in TypeScript | Eight or more membership paths across five packages, easy to miss one, every new path must remember it | Silent event loss is the failure mode the outbox exists to prevent |
| A memberships repository wrapper that all modules must use | One TypeScript entry point | The importers and the payments repository write memberships directly by design (0015) | Would need a large refactor in Step 13 |
| Change data capture (logical replication) | Catches every change | Extra services and superuser setup | Breaks the self hosting constraint, same as in 0014 |

## Consequences

- Positive: every write path produces the event in the same transaction, including future ones.
- Positive: last activity costs one conditional update at most once an hour per member and community.
- Negative: part of the event logic lives in SQL. The triggers are covered by integration tests in `@cohory/events` and `@cohory/webhooks`.
- Negative: test roles that write memberships, progress, RSVPs, or subscriptions now need insert on `outbox`.
- Negative: `member.removed` cannot tell leaving from removal; it carries the new status (`removed`, `banned`, or `pending`).

## Open questions

- Whether `post.deleted` and `comment.deleted` should be published to webhooks. Owner: product.
