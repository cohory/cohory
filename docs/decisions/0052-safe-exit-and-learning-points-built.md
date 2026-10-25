# 0052. Safe exit and learning points follow-ups are built

Records [0027](0027-safe-exit-and-2-percent-fee.md) and [0045](0045-levels-that-unlock-and-learning-points.md) describe follow-up work as not yet built. That work shipped by 0.12.0. Accepted records are not edited, so this record states the current position and the two records point here.

- ADR status: Accepted (founder, 2026-10-25)
- Date: 2026-10-25
- Deciders: founder (2026-10-25); written during the documentation audit of 2026-10-25
- Related: [0027](0027-safe-exit-and-2-percent-fee.md), [0045](0045-levels-that-unlock-and-learning-points.md), [../architecture/payments.md](../architecture/payments.md) section 12, [../product/decisions-log.md](../product/decisions-log.md) row E-36

## Context

The "Follow up" bullet in the Consequences of 0027 says the exit runs table, the `disconnecting` and `deleting` community states, and the exit paths ship in later Step 18 units. The summary and Consequences of 0045 say the learning points switches are not in Manage, Settings, that MCP tools do not show the lock fields, and that the archive does not carry `required_level` or the switches. All of that is built in 0.12.0, so a reader of either record would take a finished feature for a pending one.

## Decision

As of 0.12.0 the following is built, and the Consequences of 0027 and 0045 are read as history:

1. **Safe exit paths.** Migration `0029_safe_exit_payments.sql` added the `payment_exit_runs` table and the `disconnecting` and `deleting` states. The worker job `payments.exit-run` carries out the exit. The behavior and its verification are in payments.md sections 12.15 and 12.16.
2. **Learning points switches.** Manage, Settings, Points holds the "Points for finished lessons" and "Points for attended events" switches (`pointsForLessons` and `pointsForEvents` in the gamification form).
3. **Lock fields for agents.** MCP course tools return `requiredLevel` and `locked`, as the registry snapshot test asserts.
4. **Archive fields.** The archive format carries `requiredLevel` on courses and `pointsForLessons` and `pointsForEvents` on the community record.

Nothing in the Context or Decision sections of 0027 and 0045 changes.

## Consequences

- The status lines of 0027 and 0045 point here, so a reader finds the current position without editing an Accepted record.
- No code changes. This record only corrects what the two older records say about what is built.

## Open questions

- None.
