---
name: autonomous-run
description: Use when the human steps away ("going to bed", "run until done", "don't stop", "be fully autonomous", "I'll check back later"), when running unattended under the loop skill or a scheduled agent, or when a large task with no matching workflow must be driven to completion without check-ins.
---

# Autonomous run

You own the exit condition. Define done, then drive to it without stopping.

## 1. Frame before the first iteration

- **Exit predicate.** A checkable statement: "all tests in `packages/payments` pass and the checkout flow completes in the running app", "PRs 12 to 15 are merge-ready". Never relax it to declare victory.
- **Scope.** Rough units of work and the blockers you already see.
- **Rigor.** Higher for one-way doors (schema migrations on real data, payment flows, auth) and wide blast radius. Rigor means gates and artifacts, not effort.
- **Plan.** For multi-step work, write it with `superpowers:writing-plans`. If no plan exists and the task is large, design the phases yourself: riskiest unknown first, verification harness before the work, scaffold before features.

A multi-hour run earns one framing message to the human before you start. Then proceed without waiting for a reply.

## 2. Start the decision trail

Open a log with `show-me-your-work`. Every iteration adds a row.

## 3. Iterate

Each iteration is an experiment.

1. State the hypothesis or the unit of work.
2. Make the smallest change the evidence justifies.
3. Verify against the predicate on the real artifact (tests, the running app, the database row), never a self-report.
4. Commit if it advanced. Revert if it did not. A change that "might help" is reverted, not left in.

Verify each unit before starting the next. A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass.

For waiting on CI or an external event, use `gh pr checks --watch` or the `loop` skill with an interval sized to when the result is worth checking. Do not write sleep loops.

## 4. Own mid-run discoveries

Broken tooling, flaky tests, related bugs, stale docs: fix them yourself. Put unrelated fixes in their own commit or PR, then return to the predicate.

## 5. Never block on the human, except here

Proceed on everything reversible. Stop and wait only for:

- Irreversible actions: force-push to a shared branch, merging to `main` without an explicit request, deploys, deleting data, live Stripe operations, messages to real users, publishing packages or images.
- Product or taste calls no experiment can settle. Prototype first (see `prototype`). If still unsettled, pick a sensible default, record it as a decision row, and keep going on the parts that do not depend on it.
- A genuine dead end that survived a change of approach.

Batch these into one message instead of asking one at a time.

## 6. Stop when the predicate is met

A plateau is not a stop. Change approach and push past it. If you hit a real dead end, say so clearly instead of spinning. If the session must end before the predicate is met, run `session-handoff` to leave a clean resume point.

## 7. Hand back

Verify the whole against the predicate on the real artifact. Turn any correction you made twice into a check (see `correct`). Run the cross-model review and audit from `show-me-your-work`.

## Reply

The exit predicate and its final state, iterations run, what landed (with PR links), what was reverted, decisions made on the human's behalf, the trail path, and what still needs a human.
