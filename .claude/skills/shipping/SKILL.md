---
name: shipping
description: Use when asked to "land", "ship", "merge", or "merge when ready" a green PR or PR stack, or to cut a release. Verifies each PR independently, lands only the verified run from the bottom of the stack, and confirms each merge.
---

# Shipping

You own what lands. Green CI is not safe. Verify each PR independently, land only the contiguous verified run from the bottom, and keep your hands off the rest of the stack while it lands.

Merging is a shared, hard-to-reverse action. Only start this skill on an explicit request to merge, land, or ship.

## 1. Verify each PR independently

One verifier per PR, an `Agent` subagent that did not write the code. It checks out the PR head, runs the change the way a user would (the project's verify skill if one exists, see `create-verification-skill`), compares against the parent, and returns `PASS`, `PASS+NOTES`, or `FAIL` with evidence. Post the verdict as a PR comment.

Green CI and an approving bot are inputs, not verdicts. Neither runs the change as a user would.

## 2. Land only the verified run from the root

Walk up from the lowest unmerged PR and stop at the first one without `PASS` or `PASS+NOTES`. The PRs below that point are the run. The top one is the ceiling. A verified PR above an unverified one waits.

## 3. Check that verdicts still describe the code

A rebase moves every PR above it to a new SHA without failing any check. Before trusting an older verdict, compare patch ids:

```bash
git diff <base>...<verdict-sha> | git patch-id --stable
git diff <base>...<current-head> | git patch-id --stable
```

If they differ in anything beyond tests, docs, or lint config, verify again.

## 4. Land bottom-up, one PR at a time

1. `gh pr merge <n> --squash` on the lowest unmerged PR in the run.
2. Confirm it landed: `gh pr view <n> --json state,mergedAt,baseRefName`. It must read `MERGED` with `main` as its base. A queued merge or requested auto-merge is not a merge.
3. Retarget the next PR to `main` (`gh pr edit <next> --base main`), rebase it onto the merge result, and push with `git push --force-with-lease`.
4. Recheck its patch id against its verdict, wait for checks, then merge it.

Arm `gh pr merge --auto` only on a PR whose verdict covers its current head.

## 5. Leave the stack alone while it lands

The step 4 retarget is the only change you make to a branch or base. If a merge stalls, find out why before changing anything.

## 6. Stop at the ceiling

Extending the run needs new verdicts, which is a new pass through step 1.

## Releases

When cutting a release (tag, changelog, Docker image):

- Run `docs-audit` first. The tag waits until its four scripts are clean and the audit PR has merged.
- Confirm `main` is green and every merged PR since the last tag has a verdict.
- Generate the changelog from Conventional Commit subjects since the last tag (`git log <last-tag>..HEAD --oneline`). Write it with `technical-writing`.
- Pause for the human before pushing a tag, publishing an image, or deploying. These are irreversible.

## Reply

The verified run and its ceiling, each PR's verdict and who produced it, what landed and how you confirmed it, and what the next gap needs.
