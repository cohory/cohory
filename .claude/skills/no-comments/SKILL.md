---
name: no-comments
description: Use when about to request review or open a PR, or when asked to "strip comments", "clean up comments", or "remove narration". Deletes comments that narrate, justify workarounds, or restate code, and turns real constraints into types, tests, or lint rules.
---

# No comments

Comments that narrate code, explain a workaround in our own code, or say "do not remove" are a smell. The fix is code that makes the behavior obvious, or a check that enforces the constraint. This skill runs a fresh, read-only reviewer over the diff, then acts on its findings.

## Scope

Use the files or diff the human names. Otherwise `git diff main...HEAD` plus the working tree. Never touch code outside the scope.

## Steps

1. **Spawn the reviewer.** One `Agent` subagent with the prompt in `references/comment-reviewer.md` and the scope. It reports. It does not edit.
2. **Check its report.** Reject flags outside the scope, deletions of comments that match a keep exception, and flags that call deliberate code guilty without evidence. For a thin `IMPORTANT` or `do not remove` claim, run `how` or `why` on the symbol before deciding. If a keep claim is refuted or still ambiguous after that, delete the comment.
3. **Apply accepted deletions.** Remove the comments.
4. **Fix flagged code.** For each `RESHAPE` flag, make the smallest root-cause change in scope: rename, extract a well-named function, tighten a type, delete a dead path, or use the real API. If the fix needs a new shape, run `architect` once for the whole set and stop at the sketch before implementing. Never replace a deleted comment with a shorter version of the same excuse. If the root cause is out of scope, land the in-scope fix and report the rest as open.
5. **Encode constraints.** A comment that says "do not change", "must stay in sync", or "talk to X first" describes a constraint. Offer the cheapest enforcement in scope: a type, a runtime assertion, a test, or a lint rule. In an unattended run, apply it if it is small and reversible. Otherwise delete the comment and report the constraint as open.
6. **Run checks.** Typecheck, lint, and tests for the touched packages.

## Keep exceptions

These survive:

- License headers.
- Non-obvious behavior forced by something we cannot change (a vendor API, a browser bug, a Stripe or Next.js contract), with a link when one exists.
- TSDoc on exported functions and types that defines a public contract.
- Links to an issue or RFC that explains a constraint code cannot express.
- Lint suppressions whose rule is style-only or wrong for this line, each with a reason on the same line.

Suppressions of rules that catch real bugs (`@ts-ignore`, `@ts-expect-error`, `eslint-disable` for hooks dependencies, unsafe any, floating promises) are flagged for a real fix.

## Report

Deletion count, comments kept and why, reshapes made, constraints encoded, constraints left open, and any reviewer flags you rejected with the reason.
