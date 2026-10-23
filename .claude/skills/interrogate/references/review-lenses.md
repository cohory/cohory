# Review lenses

Apply the lenses that fit the change.

## Correctness

- Edge cases: empty input, null, boundary values, concurrent requests.
- Errors: caught, propagated, or silently swallowed?
- State: race conditions, stale closures, cache invalidation after mutations (`revalidatePath`, `revalidateTag`).
- Idempotency: what happens if this webhook, job, or action runs twice, or crashed halfway?
- Concurrency: if two requests or jobs write the same row, is it serialized by a transaction, a unique constraint, or a lock, or only by convention?

Trace the path that makes a value null. Do not just say "this could be null".

## Root cause versus symptom

Read beyond the diff. Look for guards that mask a broken invariant, retries that hide a broken contract, casts that silence a modeling error, and fixes in module A that belong in module B. If the fix is a comment saying "do not do X", ask whether a type, lint rule, or test could make X impossible.

## Structure

- Validation at boundaries, not scattered through business logic.
- Logic in the right package. Feature logic does not leak into `packages/kernel`, `packages/infra`, or `packages/ui`.
- Data model fits the access pattern. Indexes exist for the queries.
- Bolted on versus integrated: would the code look like this if the requirement had been known from the start?
- Legacy dual paths: a new API added while the old one stays alive with no external consumer.

Do not penalize simple code for lacking abstraction.

## Verification

- Tests exist and assert behavior, not implementation.
- A bug fix has a regression test that fails without the fix.
- Integration boundaries (database, Stripe, auth) are exercised for real where practical.
- Delegated work is verified by its artifacts, not its self-report.

## Complexity budget

Abstractions with one call site, configuration for cases that do not exist, dead code, unused exports, compatibility paths for finished migrations, features or options that do not earn their place.

## Security and tenancy

Trace each input path and show it.

- User input reaching SQL (raw `sql` templates), HTML (`dangerouslySetInnerHTML`, markdown rendering), redirects, or file paths without validation.
- Server actions and route handlers that skip the session check, the role check, or the community scope.
- IDOR: an id from the client used to load or mutate a row without checking ownership or membership.
- Stripe: webhook signature verified on the raw body, connected account id taken from our database not the client, amounts computed server-side, idempotency keys on mutations.
- Secrets in code, logs, error messages, or client bundles (`NEXT_PUBLIC_` on a secret).
- Uploads: content type and size limits, signed URLs scoped and short-lived.
- TOCTOU in permission checks.

## Strict code-quality lens

Be ambitious about structure. Look for restructurings that keep behavior and make the code much smaller and more direct.

1. A file growing from under 500 lines to over 500 needs a strong reason. Prefer extracting a module or component.
2. No spaghetti growth: new ad hoc conditionals or one-off branches inserted into unrelated flows are a design problem, not a nit.
3. Prefer cleaning the design over accepting working code, when the cleaner version removes moving parts.
4. Prefer boring code over magic. Flag thin wrappers and pass-through helpers.
5. Question unnecessary optionality, `any`, `unknown` left unparsed, and cast-heavy code.
6. Reuse existing helpers and components (`packages/ui`, `packages/kernel`) instead of writing one-offs.
7. Flag needless sequential awaits and non-atomic multi-row updates.

Presumptive blockers unless justified: a missed simplification that would delete a lot of complexity, a file pushed past the size threshold, ad hoc branching in a shared flow, a duplicated helper, logic in the wrong package.

## Lead judgment rules

- **Nitpick gravity.** Reviewers fill space. If every finding is a nit, the code is probably fine. Say so.
- **Hypothetical versus actual.** "What if someone passes null" counts only if a caller can. Trace it.
- **Premature abstraction.** Does the code need to change in a second way? If not, the suggested abstraction is premature.
- **"I would have done it differently."** Not actionable without a concrete problem.
- **Missing context.** Findings about code the change did not touch, or patterns consistent with the rest of the repo, usually reflect limited context.
- **When reviewers are right.** Independent agreement, a concrete execution path, a gap in your own mental model, or the reaction "yeah, actually". Take those seriously.
