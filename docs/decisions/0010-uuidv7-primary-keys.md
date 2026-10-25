# 0010. UUIDv7 primary keys

Use application-generated UUIDv7 values as primary keys for all tables.

- ADR status: Accepted (founder, 2026-10-25)
- Date: 2026-10-17
- Deciders: architecture docs wave
- Related: [../architecture/data-model.md](../architecture/data-model.md) section 1

## Context

Ids appear in URLs of the API, in exports that must import into another instance without collisions (REQ-MIG-002), in webhook payloads, and in MCP tool results. Ids must not reveal counts (how many members a community has). Inserts should stay index friendly. Some objects are created before they are written (outbox events, import id maps).

## Decision

- Primary keys are UUIDv7 generated in `packages/kernel` and stored as PostgreSQL `uuid`.
- Human-facing URLs use slugs or usernames, not ids, where the IA defines them.
- External provider ids (`cus_...`, `sub_...`) are stored in separate columns, never used as primary keys.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Bigserial integers | Small, fast, readable | Leak counts, collide across instances on import, need the database to allocate | Export and import across instances is a core promise. |
| UUIDv4 | Unique, standard | Random inserts fragment B-tree indexes, no time order | UUIDv7 keeps the benefits with ordered inserts. |
| ULID or nanoid in text columns | Sortable (ULID), short (nanoid) | Text storage is larger, no native type | `uuid` type is native and compact. |
| Database-generated UUIDv7 | One source | Requires a PostgreSQL version or extension with UUIDv7 support | Application generation works on every supported version. Revisit when native support is common. |

## Consequences

- Positive: ids are globally unique, sortable by creation time, safe to expose, and stable through export and import.
- Negative: 16 bytes per key instead of 8. Acceptable.
- Negative: UUIDv7 encodes creation time to the millisecond. Not sensitive for our entities.
- Follow-up: id helper, tests that ids are monotonic within a process.

## Open questions

- Whether to switch to native PostgreSQL generation once the minimum supported PostgreSQL version provides it.
