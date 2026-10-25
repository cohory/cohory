---
name: opening-a-pr
description: Use when about to commit, rebase commits for review, write a commit message, open a pull request, or split work into stacked PRs in Cohory. Covers commit shape, Conventional Commits titles, the PR body structure, and stacks.
---

# Opening a PR

`superpowers:finishing-a-development-branch` decides whether to merge, open a PR, or discard. This skill covers how to shape the commits and the PR once you open one.

## Before the first PR command

1. Work in a worktree or branch off `main` (`superpowers:using-git-worktrees`). Never commit to `main` directly.
2. Run `no-comments` over the diff.
3. Run `pnpm verify:changed` once (typecheck, lint, unit tests, and integration tests for the touched packages and their dependents). Push with git hooks enabled. Never pass `--no-verify`.
4. For changes to auth, payments, tenancy, or the schema, run `interrogate` first.
5. Confirm with `superpowers:verification-before-completion` that every claim in the PR body has evidence.
6. Update every doc the change touches in the same PR (AGENTS.md section 8): `docs/product` for screens and labels, `docs/architecture` for code shape, `docs/operations` for operator steps, and a decision record for an architectural change. The PR checklist asks for it.

## Commits

- Commit often while working. Before opening the PR, rebase into small, ordered commits. Each commit builds and passes checks on its own.
- Order commits so the history argues for the change: a failing test before the fix, a deletion before the reshape, the scaffold before the feature.
- Amend when a fix belongs in the commit you just made. Add a new commit when it is separable.
- Subject lines use Conventional Commits: `type(scope): subject`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`. Scope is the package or module name (`web`, `worker`, `db`, `payments`, `communities`, `courses`, `ui`, `skills`). Subject is imperative, short, no trailing period, and names a real symbol when one carries the change.
- Commit bodies explain why, not what. Do not restate the subject.
- No `Co-Authored-By` trailers. Never mention AI assistants.

## PR title

Same format as a commit subject. Example: `fix(payments): verify webhook signature on raw body`.

## PR body

Fill the template in `.github/PULL_REQUEST_TEMPLATE.md`. It is a one-minute briefing for a reviewer who has the diff: short sentences, few identifiers, no walls of text.

- `## Summary`. The problem and the approach in one to three sentences, what changed (name both sides of a rename), what the PR deliberately leaves out, and the issue it closes. For migrations, auth, and payment changes, add one or two sentences on the blast radius and why it is safe. Mention a rejected alternative only when a reviewer would otherwise ask about it.
- `## Verification`. One to three bullets, each a command or user path you actually ran and its result. Evidence of what was done, never a checklist for the reviewer. Do not add a "Test plan" section.
- `## Checklist`. Tick each item only when it is true.

Attach screenshots or a short video for any UI change, at desktop and mobile widths. Long logs, benchmark tables, and decision trails go in a linked file or gist, not the body.

Write the body with `technical-writing`. No dashes as punctuation, no emojis, no mention of AI assistants.

## Size and stacks

- Prefer several narrow PRs over one large one. A migration, the code that uses it, and the UI on top are three PRs.
- A stack is a base-branch chain. The root PR targets `main`. Each child branch is based on its parent's tip and its PR targets the parent branch: `gh pr create --base <parent-branch>`.
- When a parent merges, retarget the child to `main` (`gh pr edit <n> --base main`), rebase it onto the merge result, and push with `git push --force-with-lease`. Never plain `--force`.
- Branch from `main` only for independent work.

## Readiness

Open PRs ready for review, not as drafts, unless the human asks for a draft. Check status with `gh pr view <n>` before you describe it.

Opening a PR does not start babysitting. Post the URL and keep building. Use `babysit-pr` when the human asks or when the stack is complete.
