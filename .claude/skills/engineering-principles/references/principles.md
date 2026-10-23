# Principles in full

Adapted from the pstack principle skills. Each section gives the rule, why it exists, and the test that shows you applied it.

## Laziness protocol

Bias toward deletion and the smallest change that solves the problem. Consolidate a repeated choice behind one source of truth and pass the result down as a simple value. Fewer lines beat elegant boilerplate.

## Foundational thinking

Structural decisions protect option value. Code-level decisions protect simplicity.

- Define core types early, trace every access pattern, and pick structures that match the dominant paths.
- DRY the structure, not every line. Three similar statements beat a premature abstraction.
- Before sharing state between actors, ask what happens if another actor changes it at the same time. If the answer is not "nothing", isolate it.
- Scaffold first. CI, linting, test setup, and shared types help every later phase, so they come first. Keep commits small and single-purpose.
- Remove dead code before laying foundations.

## Redesign from first principles

Read every affected file. Ask what you would build from scratch with the new requirement. Propagate the change through types, docs, examples, and rationale. Think about the whole redesign, then deliver it in increments.

## Attack the premise

When two or more fixes that share one premise fail the same gate, suspect the premise.

- Write the premise as one sentence.
- Find an observation that would come out differently if the premise were false, and make it. Look at how failures are distributed, not only how large they are.
- If the evidence contradicts the premise, look for what the failures share that the premise did not predict.
- Remove the condition instead of compensating for it.

Do not start the next fix before the premise is written down and tested.

## Subtract before you add

Remove complexity first, then build. Design for observed usage, not speculative edge cases. No speculative validators or guards beyond what the spec demands. When a reference has no new content, delete it.

## Minimize reader load

Track two axes: layers to trace and state to hold.

- Collapse wrappers with one caller and adapters with no second implementation.
- A layer that repeats the same methods and arguments adds load without compression.
- Prefer pure functions, locals over module state, and derived values over synced copies.
- Name an invariant at the boundary so the reader learns it once.

Test: a new reader answers "where does X come from?" and "what can change X?" in under 30 seconds.

## Outcome-oriented execution

For planned rewrites with explicit phase boundaries, prioritize end-state integrity over transitional stability. Declare where temporary breakage is acceptable, keep checks on actively touched areas, and require full static and runtime verification at the end.

## Experience first

When implementation convenience conflicts with user delight, choose delight. Every feature, control, and option must justify itself. Get the details right: transitions, alignment, spacing, feedback, and error states. The user is whoever consumes the work. For a package API that is the next engineer.

## Exhaust the design space

For a novel UI interaction or architecture with no precedent, build two or three competing prototypes and compare them side by side before committing. Also applies to product decisions that depend on feel rather than logic.

## Build the lever

Default to building the tool that does the work: a codemod for edits, a generator for repeated files, a script for analysis, a rerunnable check for verification. Do the first unit by hand to learn the recipe, then build the tool and prove it by diffing its output against the hand-done unit. When fanning work out to subagents, write the recipe, the verification contract, and the forbidden paths into one brief or skill that every subagent reads. If you cite this principle and the diff has no script, you did not apply it.

## Model the domain

Encode the domain in a data structure instead of conditionals. Reach for a state machine instead of booleans, a discriminated union instead of optional-field bags, a lookup table instead of branching across files, and a module organized around one body of knowledge instead of load, validate, transform, save stages. Do not force an abstraction when the current shape is clear and local. The sign you skipped this is a feature that adds one more branch to an existing if/else chain, or a second boolean that must stay in sync with the first.

Cohory examples: membership status (`trialing`, `active`, `past_due`, `canceled`) as a union, not `isActive` plus `isCanceled`. Gamification level thresholds as one table, not `if` chains in three components.

## Boundary discipline

- At boundaries (route handlers, server actions, webhooks, env vars, form input, third-party API responses): validate with zod, return typed errors.
- Inside: typed data, no re-validation, no defensive null checks the types already rule out.
- Do not re-export transport, storage, or framework types through a package's public API. Parse into domain types.
- Business logic lives in pure functions with no Next.js or Drizzle dependency, so it is testable without the framework.

## Type system discipline

Brand semantic primitives (`CommunityId`, `UserId`). Treat external data as `unknown` until parsed. Derive types from the authoritative schema (Drizzle tables, zod schemas, Stripe SDK types) instead of hand-writing a parallel interface. Exhaust union variants with a `never` check.

## Make operations idempotent

Derive each step from the state that exists, not from what the last run meant to do. Read current state, compare to the goal, apply only the difference. Anything a run leaves behind (a lock, a half-written row, a claimed job) must be recognizable as stale by the next run.

Test: what happens if this runs twice in a row? If the previous run crashed at every possible point? Does it converge?

Cohory examples: Stripe webhooks keyed by event id, queued jobs with deterministic job ids, seed scripts that upsert.

## Migrate callers, then delete legacy APIs

When no external user depends on the old API, migrate every caller and delete the old API in the same wave. Update tests to assert the new contract and delete tests that only protect the old implementation.

## Separate before serializing shared state

1. Identify shared mutable state: files, branches, rows, cache keys.
2. Default: give each actor its own target and merge at read time.
3. Only when one shared target is a real invariant, serialize structurally (a lock, a single writer, a transaction, compare-and-swap). Instructions and conventions are not concurrency control.

For agents: one writer per branch or worktree.

## Prove it works

Check the real thing, not a proxy. Read the actual value, not a cached copy. When verification fails, suspect the observation method before the system. The strongest proof is a script that reruns the comparison.

## Fix root causes

Reproduce first. Ask "why" until the answer is a wrong decision in code. Instrument rather than guess. Ask whether the state that triggered the symptom is legitimate. If it should never exist, a guard where it broke hides the bug. Check for the pattern, not just the instance. When something fails only after a restart, suspect persisted state.

## Sequence verifiable units

Each unit is a bracket: known-good state, one change, run the check, proceed. Stack commits so the sequence reads as an argument: failing test then fix, subtraction then reshape, scaffold then feature.

## Test behavior, not implementation

Judge each test against two imagined edits. Break the behavior: the test must fail. Change only the internals: the test must pass. Derive expected values from the requirement, not from a run of the code. The payload a mocked external service (Stripe, S3) receives is behavior. A call to an internal helper is not.

## Explain the number

Ask "why not double?" and name the resource that bounds the result. List what else the number could be measuring (errors, cached work, code that never ran, an untuned side, noise) and rule each out. Keep run count, spread, and limiter with the number.

## Guard the context window

Route bulk to subagents. Size phases and cap files per phase. Keep summaries in the main thread.

## Never block on the human

The human supervises asynchronously. Proceed on reversible work, then present. Irreversible actions still need confirmation. Product direction comes from the human. Execution does not wait.

## Encode lessons in structure

If the fix can be structural, use only the structural fix. If the lesson needs judgment and cannot be encoded, make the instruction prominent and add an example of the failure.
