---
name: architect
description: Use when about to write code that crosses a function or package boundary, adds a new module, table, or public API, or when someone says "architect this", "design this first", or "sketch the types". Settles caller usage, types, and module shape before implementation.
---

# Architect

Sketch the caller's usage, the types, the function signatures, and the module map before writing logic. Explore at least two structurally different designs, pick one, then implement against it.

This skill sits between `superpowers:brainstorming` (which settles what to build) and `superpowers:writing-plans` (which sequences the work). Architect settles the shape of the code. Its output feeds the plan.

Track the phases with TodoWrite: Ground, Sketch, Pick, Implement, Scrap.

## Phase A: Ground

Build a real mental model of every system the new code touches.

1. Read `AGENTS.md` and the relevant `docs/architecture/*.md` files if they exist.
2. Run the `how` skill over each affected package or route. Naming a file is not grounding.
3. If the design changes ownership or layering, run the `why` skill on the current shape so its rationale becomes a constraint.

Skip Phase A only for true greenfield work with nothing to integrate.

## Phase B: Sketch at least two candidates

Design it twice. Spawn two or three `Agent` subagents in one message, each with the same task, the grounding notes, and `references/runner-prompt.md`. Tell each to write its candidate to its own path under the scratchpad (for example `<scratchpad>/architect-<slug>/candidate-<n>/`). Ask for whole-shape alternatives, not point variations inside one shape. For a small change you may sketch the two candidates yourself.

Each candidate contains:

- The caller's usage, written first: two or three realistic call sites in the app (a server action, a page, a job).
- The type sketch derived from that usage. Bodies are `throw new Error("not implemented")` with `// TODO` pseudocode for tricky logic.
- A module map: which package owns what (`packages/modules/communities`, `packages/modules/payments`, and so on) and what each exports.

## Phase C: Pick

1. Screen every candidate against `references/design-red-flags.md`. Assume the next contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Prefer the design where a change that looks right from one file is right for the whole repo.
2. Score candidates on interface depth: how much complexity hides behind how small a public API.
3. Pick a base. Graft at most one or two strong ideas from the others, rewritten to fit the base. Do not average designs. If candidates wildly diverge, the problem statement was underspecified. Reframe and rerun.
4. Write the rationale using `references/rationale-template.md` next to the sketch (in the plan doc or `docs/architecture/` when the decision is durable).

Default: proceed to implementation with no human checkpoint. Pause for sign-off only if the human asked ("architect with checkpoint", "show me before implementing") or the design is a one-way door (database schema that holds real data, public API, payment flow). For adversarial pressure on the sketch, run `interrogate` on it.

The sketch may land as its own commit (scaffold first).

## Phase D: Implement against the sketch

Replace `not implemented` bodies with code. The sketch is the contract. A deviation is a signal to surface, not friction to absorb. If a function needs a parameter the sketch did not anticipate, decide whether the sketch was wrong, a requirement was missed, or the implementation overreaches.

## Phase E: Scrap when the shape is wrong

If implementation keeps producing friction the sketch cannot absorb, throw it out. Tells:

- The same workaround shape appears in unrelated places.
- Several unrelated edge cases each need a special branch.
- Types need `any`, casts, or optional fields that are always set in practice.
- A "we need a lock" reflex when the sketch said state was not shared.
- Callers must know the abstraction's internal rules to use it.

A few edge cases do not condemn a design. Complexity in the data is not complexity in the design. When you scrap: rerun `how` on what you built, redesign as if the new constraints were day-one assumptions, make the new sketch smaller than the old one, and return to Phase B.

## Output

The caller usage, the type sketch, the module map, and the rationale. Hand them to `superpowers:writing-plans` or straight to implementation for small changes.
