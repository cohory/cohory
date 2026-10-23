# 0015. Migration module reads and writes module tables directly

The archive export and import in `@cohory/migration` read and write the tables of other modules directly instead of through each module's services.

Status: Draft, 2026-10-19

- ADR status: Accepted
- Date: 2026-10-18
- Deciders: engineering (proposed for 0.4.0, accepted after the 0.4.0 release verification checked the implementation against this record)
- Related: [0001](0001-modular-monolith.md), [0006](0006-shared-database-multi-tenancy.md), [../architecture/archive-format.md](../architecture/archive-format.md), [../architecture/overview.md](../architecture/overview.md) section 5, AGENTS.md section 2

## Context

AGENTS.md section 2 says each module owns its tables and others change them only through its services. A whole community archive touches about 25 tables across nine modules. Going through each service would mean:

1. New service operations in every module that accept historical timestamps, authors, counts, and ids, which the normal operations deliberately refuse (a post service that lets the caller set `created_at` and the author is a hole in normal use).
2. Side effects on every write: notifications for every imported mention, points for every imported like, emails, outbox rows. An import of 10,000 posts would notify members about content that is years old.
3. No single transaction per batch, so a retry could not tell what was written.

Account erasure (`identity.account-purge`, 0.3.0) faced the same problem and was recorded as a boundary exception.

## Decision

- `@cohory/migration` reads and writes module tables directly with Drizzle, inside a community scope that sets `app.community_id` and the manager settings each table's RLS policy expects (`app.migration_manager`, `app.community_manager`, `app.course_manager`, `app.calendar_manager`, `app.payments_manager`, and `app.user_id` per person for lesson progress and RSVPs). It never bypasses row level security.
- It sets those settings only after the service checked `migration.export`, `migration.import`, or `migration.import_members` for the community owner, and the worker checks again that the requester is still the owner.
- It reuses module code where a module owns a rule that must hold for imported data: the post content parser and renderer from `@cohory/posts`, accent tokens from `@cohory/communities`, storage key validation from `@cohory/storage`.
- It writes no outbox rows and sends no notifications for imported content. Counts (likes, comments) are recomputed from the imported rows.
- Every schema change to a table in the archive needs a matching change in `src/format/records.ts`, `src/export/collect.ts`, and `src/import/restore.ts`. The round trip test fails when they drift.

## Consequences

- One package knows the shape of most tables. Changing a module's table now has a second place to update, which the round trip test guards.
- Imports are fast and silent and can be retried batch by batch.
- Module invariants that live only in service code (for example slug generation) are not re-run on import; archive values are validated by the format schemas and the database constraints instead.

## Alternatives considered

- **Import through module services.** Rejected for the side effects and the timestamp and author problem above.
- **Per module export and import functions.** Cleaner ownership, but nine new public surfaces for one feature. Worth revisiting if a module's table grows rules that the migration module keeps getting wrong.

## Decisions and open questions

- **Recommendation:** accept this exception alongside the account erasure exception.
- **Open question:** whether to move to per module export and import functions once the archive format reaches 2.0.0.
