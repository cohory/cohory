---
name: interrogate
description: Use when asked to "interrogate", "tear this apart", "stress test this", "adversarial review", or "find blind spots" in a diff, branch, PR, or design sketch, and before shipping any change to auth, payments, tenancy, or the database schema. Runs independent adversarial reviewers and returns a judged verdict.
---

# Interrogate

Spawn independent reviewers to attack a change from separate angles, then judge their findings as a pragmatic lead engineer. The deliverable is a verdict. Do not apply changes automatically.

This complements `superpowers:requesting-code-review`, which runs one reviewer against requirements. Interrogate adds parallel adversarial reviewers, a strict code-quality lens, and a lead-judgment pass that filters noise. Process the resulting feedback with `superpowers:receiving-code-review`.

## 1. Scope

- If the human points at files, a diff, or a PR, use that. For a PR, `gh pr diff <number>`.
- On a feature branch, `git diff main...HEAD` plus the working tree.
- For a design sketch from `architect`, review the sketch files and rationale.

Collect the surrounding files a reviewer needs: callers, types, the Drizzle schema, and relevant `docs/architecture/*.md`.

## 2. Intent

Write one paragraph stating what the change is meant to do, from the human's request, commit messages, PR body, and code. If you cannot tell, ask before spawning.

## 3. Spawn reviewers

Spawn reviewers in one message with the `Agent` tool so they run in parallel. Default to three, each with a different lens emphasis so they do not converge:

| Reviewer | Emphasis |
|----------|----------|
| A | Correctness, idempotency, concurrency, root cause versus symptom |
| B | Security and tenancy: authz on every path, input validation, secrets, Stripe and webhook handling |
| C | Code quality and structure, using the strict lens |

If a different model is available for subagents, run at least one reviewer on it. Model diversity raises signal. Every reviewer gets the prompt from `references/reviewer-prompt.md` filled with the intent, the diff, and the lenses from `references/review-lenses.md`. Reviewers are read-only. Tell them not to edit files.

## 4. Synthesize

Merge findings that describe the same issue. Note which reviewers raised each. Findings raised independently by two or more reviewers carry the most weight. Note direct disagreements.

## 5. Judge

You are the lead reviewer, not a neutral aggregator. Apply the judgment rules at the end of `references/review-lenses.md`. Trace every hypothetical to a real call site before accepting it. Place each finding in one bucket with its source reviewers and a one-line reason:

- **Act on.** Real correctness, security, or maintainability problems that would block a real PR.
- **Consider.** Legitimate, but the cost may outweigh the benefit now.
- **Noted.** Valid but not actionable at this stage.
- **Dismissed.** Wrong, nitpicky, or missing context, with the reason.

Be slow to dismiss security, tenancy, payment, and data-loss findings even when only one reviewer raised them.

## Output

```
### Intent
> <paragraph>

### Reviewers
- A (<emphasis>, <model>): N findings

### Act on
### Consider
### Noted
### Dismissed
### Agreement map
<where reviewers agreed or diverged, and what that says>
```
