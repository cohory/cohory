# Worker brief template

Every field is required. Collapse to a paragraph for one-command units, but keep goal, scope, verify, and report.

```
GOAL         One sentence. The outcome, executable by someone with no chat access.
SCOPE        Paths this unit may write. Paths it may not. Its branch or worktree.
CONTEXT      Pointers to files, docs (AGENTS.md, docs/architecture/*.md), issues, PRs.
             Upstream reports pasted in full when this unit depends on them.
DATA SHAPE   The types or tables this unit introduces or changes, and their
             organizing structure (union, state machine, table).
ACCEPTANCE   Checkable criteria, one per line.
VERIFY       Exact commands (pnpm --filter <pkg> test, pnpm typecheck, the verify
             skill path) and known gotchas.
TIMEBOX      Rough cap. On expiry, return partial findings and stop.
FORBIDDEN    No PR retargets, merges, rebases, or force-pushes. No edits outside
             SCOPE. No new dependencies without listing them in the report.
             Plus unit-specific bans.
REPORT       Status (DONE, PARTIAL, BLOCKED), branch, head SHA, PR URL, the exact
             commands run and their output summary, deviations from the brief,
             suggested follow-ups.
SKILLS       Skills to follow: typescript-best-practices, engineering-principles,
             superpowers:test-driven-development, opening-a-pr, plus any others.
STANDING     <standing-orders.md pasted verbatim>
```
