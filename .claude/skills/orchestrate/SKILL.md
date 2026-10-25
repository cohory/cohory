---
name: orchestrate
description: Use when one coordinator agent runs a multi-day or many-PR program through fleets of subagents ("run this whole project", "own this migration until it lands", "build the MVP backlog"), or when writing briefs for parallel worker agents, tracking their results, and keeping a PR stack mergeable.
---

# Orchestrate

You own the program, never the code. Write briefs, drain results, keep the merge frontier green, and decide. This extends `superpowers:subagent-driven-development` and `superpowers:dispatching-parallel-agents` with what a long program needs: a brief contract, standing orders, a verification ledger, and stack safety.

Route here only when the work outlives one agent session. One task driven to a predicate is `autonomous-run`.

## Three rules

- Completions are queue events, not interrupts.
- Every spawn carries the standing orders verbatim.
- The brief is the product. A worker cannot ask you questions, so a vague brief fails quietly.

## Roles

- **Coordinator (this session).** Frames, writes briefs, drains results, reports to the human, makes judgment calls. Does not write application code. Rebases, conflict resolution, and code changes are tasks for workers. Mechanically landing a verified commit (clean fast-forward or cherry-pick, then push) is bookkeeping the coordinator may do.
- **Worker.** One `Agent` subagent per unit, in its own worktree (`isolation: "worktree"`) or branch. One writer per branch. Prefer fewer, broader workers over many tiny ones.
- **Verifier.** A separate subagent that did not write the code, on a different model when available. Only for units whose verification is expensive, judgment-heavy, or high blast radius. For a unit verified by one cheap command, the worker runs it and you spot-check the output.

Cap in-flight workers at what you can review in one drain and what the machine can run, roughly three to five on one developer machine (heavy test commands share the test slot pool in `AGENTS.md` section 11). Refill as a rolling window, not blocking batches.

## Program store

Create `.agents/orchestrate/<program-slug>/` (out of git). Every file has exactly one writer.

- `standing-orders.md`. Numbered constraints, one per line: model policy, stack shape, verification bar, forbidden paths, escalation policy. Paste it into every brief. When you catch yourself repeating an instruction, add a line before acting.
- `units.tsv`. One row per unit: id, state, branch, PR, head SHA, brief path. States: `queued`, `running`, `needs-verify`, `verified`, `landed`, `failed`, `abandoned`.
- `ledger.tsv`. One row per verdict, keyed by PR number plus head SHA: `live-verified`, `test-verified`, `typecheck-only`, `verifier-blocked`, `verifier-failed`. A new head SHA voids the row.
- `gates.md`. Questions parked for the human, each with options and the default you will apply if no answer comes.
- `decisions.tsv`. The trail, per `show-me-your-work`.

## The brief

Use `references/brief-template.md`. A field you cannot fill means the unit is not scoped yet. Do not spawn it. Size the brief to the unit: a one-command change gets a paragraph that still names goal, scope, the verify command, and the report shape.

A dependency is a context relay. When a unit depends on another, paste the upstream report into the downstream brief, because workers cannot see siblings.

## Steps

1. **Frame.** State the done predicate as something countable ("all 18 backlog units landed, each `test-verified` or better"). Quantify units, expected PRs, and the time budget. If one agent could finish it within the budget, use `autonomous-run` instead. Present the framing once, then proceed.
2. **Set up the store.** Write the standing orders before the first spawn.
3. **Pilot.** Push one unit through the whole path (brief, worker, verification, PR, ledger row, merge) before fanning out. Fix the brief template and verify recipe from what the pilot shows.
4. **Scale.** Spawn the rolling window. After each drain, recompute what is ready and relay upstream reports into downstream briefs.
5. **Drain.** At natural points (after a critical section, when several completions are waiting, before a human report), classify each completion as landed, needs-verify, failed, or noise. Update `units.tsv` and `ledger.tsv`. Spawn the next wave in one message. Never deep-review a diff inside a drain. A completion that needs review becomes a verifier unit.
6. **Land continuously.** Start integrating with the first verified unit, per `shipping`. By roughly 70 percent of the time budget, stop spawning and land what is verified.
7. **Close.** Reconcile every spawned agent to a terminal state, confirm the predicate on the real artifact, confirm every landed PR has a ledger verdict for its final head SHA, audit the trail, and encode recurring corrections into the standing orders or a check (see `correct`).

## Stack safety

- Exactly one actor per stack may rebase, force-push, retarget, or merge. Name it in the standing orders.
- Workers never rebase, retarget, or merge. Babysitters follow `babysit-pr`.
- Never close a base PR without retargeting its children first.

## Failure handling

- Never resume a finished agent to check on it. Check side effects: the branch, the PR, the ledger.
- Retry by cause: scope too large, respawn smaller. Tool error, retry once, then on a different model. Two failures, abandon the unit and replan around it.
- A late result is reconciled against the current frontier before anything is accepted.
- When output across the program turns bad (broken upstream, wrong acceptance criteria), write a stop line at the top of the standing orders, let in-flight work finish, fix the cause, then clear it.

## Escalate to the human

Batched, not per item: irreversible actions, product or taste calls no experiment settles, a standing order that contradicts reality, and a program-level dead end. Park each in `gates.md` and route work around it. Never escalate rebases, retries, flaky CI, review-thread triage, or "should I keep going".

## Reply

At checkpoints and close: the predicate and the count against it from `units.tsv` and `ledger.tsv`, what landed (PR links), what was abandoned and why, open gates, and the store path. Numbers from the tables, not narrative.
