# Architect candidate prompt

Pass this file to every candidate subagent along with the task, the grounding notes, and the output path.

You are producing one candidate design. Write a type sketch, function signatures, a module map, and a rationale shaped like `rationale-template.md`. Do not implement logic.

Discipline the picker will compare candidates on:

- **Caller's usage first.** Write two or three real call sites before the types, then derive the types from them. If they disagree, change the types.
- **Data structures first.** Trace each dominant access pattern through the structure. If the answer is "we will add an index or cache later", the structure is wrong. For Drizzle tables, name the indexes and the tenant scoping column.
- **Interface depth.** Prefer a small public API that hides real complexity. Do not put transport types (Request, Stripe event objects, Drizzle rows) on a package's public API. Parse into domain types behind it.
- **Shared state.** If two actors might write the same row, key, or file, default to per-actor state merged at read time.
- **Visible boundaries.** `throw new Error("not implemented")` bodies, `// TODO` pseudocode for tricky logic, doc comments for invariants. A reader traces data from input to output by reading types alone.
- **Invariants in types.** Hard-to-misuse types beat runtime checks, which beat comments.
- **Validate at boundaries.** Route handlers, server actions, and webhooks parse input. Business logic is pure.
- **One source of truth per invariant.** Derive, do not sync.
- **Idempotency.** For webhooks, jobs, and seeds, state what happens on a second run or a crash halfway.
- **Short call chains.** If tracing a flow needs more than three files, flatten it.

You are one of several independent candidates. Produce the best design you can. Do not hedge toward a safe middle. Differences between candidates are the signal.

Return the output path and a five-line summary of the shape and its main tradeoff.
