---
name: correct
description: Use when the human corrects the same kind of mistake more than once, when review keeps flagging the same issue, when asked to "make sure agents stop doing X" or to "reflect" on a long task, or after an autonomous run that needed repeated course corrections. Turns repeated mistakes into checks that fail.
---

# Correct

Agents keep making the same mistakes in a repo until something makes the mistake fail. Change the repo so the next agent cannot make it.

Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

## 1. Find the mistake classes

Read recent commits, reverts, PR review comments (`gh pr list --state merged --limit 30`, then `gh pr view <n> --comments`), `.learnings/`, `AGENTS.md`, and comments that explain workarounds. Include corrections from the current session. Group mistakes into classes. A class counts once it has happened twice.

## 2. Fix each class at the highest level that works

1. **Architecture.** Give each piece of state one owner and each task one supported way. Hide package internals with `exports` so the wrong import fails. Replace hand-synced lists with one source. Delete old ways an agent would copy.
2. **Types.** Make the bad state unwritable (branded ids, unions, required fields).
3. **Lint or CI check.** If bad code still compiles, add an ESLint rule (`no-restricted-imports`, `no-restricted-syntax`, or a small custom rule) or a script in CI whose error message names the file, type, or function to use instead. If the pattern is already common, fail only when a change adds more.
4. **Test.** Fix or delete any test that passes when the behavior it checks breaks.
5. **Docs or agent rules last.** Only for judgment calls nothing can enforce. Add them to `AGENTS.md` with an example of the failure.

## 3. Prove each fix

One commit per class. Prove each new check fails on a real past mistake (check out or recreate the bad code, run the check, show the failure). Run the same command locally and in CI. Exceptions go on the offending line with a reason.

## 4. Keep the rules enforceable

When the human corrects you, fix the mistake and add the rule to the matching section of `AGENTS.md`, naming what enforces it (a lint rule, a type, a test file, or "judgment"). If the rule was already there and nothing enforces it, that is a repeat. Move it up a level in the same change. Drop a rule once its mistake cannot happen.

## After a long task

When a long or difficult task lands, capture what the next run should do differently.

1. Review the session for corrections, dead ends, and recipes that worked. Use an `Agent` subagent for a long transcript and keep only its summary.
2. For each finding, pick the destination: a check (above), an edit to an existing skill in `.claude/skills/`, a new skill (use `superpowers:writing-skills`), or a `.learnings/` entry.
3. Present the proposed skill edits to the human before applying them. Skill changes affect every future agent. Checks and `.learnings/` entries proceed without waiting.

## Reply

Each class with its evidence, the level you chose and why a higher level did not work, the proof that the check fails on the old mistake, and proposed skill edits awaiting approval.
