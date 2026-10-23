---
name: opening-a-pr
description: Use when about to commit, rebase commits for review, write a commit message, open a pull request, or split work into stacked PRs in Cohory. Covers commit shape, Conventional Commits titles, the PR body structure, and stacks.
---

# Opening a PR

`superpowers:finishing-a-development-branch` decides whether to merge, open a PR, or discard. This skill covers how to shape the commits and the PR once you open one.

## Before the first PR command

1. Work in a worktree or branch off `main` (`superpowers:using-git-worktrees`). Never commit to `main` directly.
2. Run `no-comments` over the diff.
3. Run the repo's checks once: lint, typecheck, and tests for touched packages (for example `pnpm turbo run lint typecheck test --filter=...[origin/main]`). Push with git hooks enabled. Never pass `--no-verify`.
4. For changes to auth, payments, tenancy, or the schema, run `interrogate` first.
5. Confirm with `superpowers:verification-before-completion` that every claim in the PR body has evidence.

## Commits

- Commit often while working. Before opening the PR, rebase into small, ordered commits. Each commit builds and passes checks on its own.
- Order commits so the history argues for the change: a failing test before the fix, a deletion before the reshape, the scaffold before the feature.
- Amend when a fix belongs in the commit you just made. Add a new commit when it is separable.
- Subject lines use Conventional Commits: `type(scope): subject`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`. Scope is the package or area (`web`, `database`, `payments`, `community`, `courses`, `ui`, `skills`). Subject is imperative, short, no trailing period, and names a real symbol when one carries the change.
- Commit bodies explain why, not what. Do not restate the subject.
- No `Co-Authored-By` trailers. Never mention AI assistants.

## PR title

Same format as a commit subject. Example: `fix(payments): verify webhook signature on raw body`.

## PR body

A one-minute briefing for a reviewer who has the diff. Short sentences, few identifiers, no walls of text. Use `##` headings in this order and drop a section with nothing to say:

- `## Why`. The problem and the approach in one to three sentences.
- `## What changed`. One to three bullets. Name both sides of a rename.
- `## Scope`. Always present. What it covers and what it deliberately leaves out.
- `## Tradeoffs`. Only rejected alternatives a reviewer would otherwise ask about.
- `## Blast radius`. One or two sentences on what it touches and why that is safe or risky. Required for migrations, auth, and payment changes.
- `## Verification`. One to three bullets, each a command or user path you actually ran and its result. Evidence of what was done, never a checklist for the reviewer. Do not add a "Test plan" section.

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
