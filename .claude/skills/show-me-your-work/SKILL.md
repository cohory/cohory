---
name: show-me-your-work
description: Use when running long, unattended, or multi-phase work, when the human will review results after stepping away, or when asked to "keep a decision trail", "log your decisions", or "show me your work". Keeps an append-only TSV of decisions with evidence and audits it before hand-back.
---

# Show me your work

Keep one decision log per run so a human can trust work they did not watch.

## Format

A TSV file with one row per decision. Cells stay on one line. Evidence is a pointer, not prose.

| Column | Content |
|--------|---------|
| `ts` | ISO 8601 UTC timestamp |
| `phase` | The phase or workstream |
| `decision` | What was chosen or done, one line |
| `why` | The reason in plain words |
| `evidence` | Commit SHA, PR number, `file:line`, command, or artifact path |
| `result` | `tests green`, `reverted`, `INCONCLUSIVE`, `open`, and so on |

Example rows:

```
ts	phase	decision	why	evidence	result
2026-10-17T09:02:00Z	frame	counted affected call sites first, 14 in 6 files	size the work before starting	grep output in notes	no blockers
2026-10-17T09:40:00Z	schema	added unique index on (community_id, slug)	slugs must be unique per community and the query filters on both	commit 3a9f1c2	migration applies cleanly
2026-10-17T11:15:00Z	webhooks	discarded a subagent's handler because its test mocked the db	the test passed with the insert removed	worktree reset	reverted, brief tightened
```

## Logging a row

Run `scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>` from this skill folder. It stamps the time, writes the header on first use, strips tabs and newlines, and guards against spreadsheet formula injection.

Log decision points, not every action: a fork chosen, a unit completed with its check result, a pivot or revert and its trigger, a blocker found. One row per loop iteration. Write each row the way you would tell a teammate. Plain words, no jargon.

When a new agent or session adds to an existing log, its first row has phase `start` and names the agent or session in `evidence`.

## Where it lives

Default: `.agents/logs/<task-slug>.tsv`, kept out of git. Commit it (for example under `docs/decisions/`) only when the work is large enough that a reviewer needs the trail to trust the result, such as a migration or a big refactor.

## Rules

- Append-only. A wrong call gets a new row that supersedes it. Never edit or delete history.
- Prefer evidence produced by committed scripts over one-off commands.

## Audit before hand-back

1. Walk this run's rows against what actually happened. Every row maps to a real decision. Every evidence pointer resolves and shows what the row claims.
2. A fork, pivot, or abandoned approach that shaped the work but is missing is a gap. Add it.
3. Correct the log by adding superseding rows, never by editing.

## Independent review of the trail

Spawn one `Agent` subagent (on a different model if available) to read the log and the diff and flag what the human should look at: decisions with weak evidence, verification claimed without proof, choices that look risky in hindsight, and gaps a skim would miss. It does not redo the work.

End the hand-back reply with an **Attention** section: the reviewer's model on the first line, then each flag with the row it concerns. "No flags" is a valid result.

Read a log in the terminal with `column -s$'\t' -t <logfile>`.
