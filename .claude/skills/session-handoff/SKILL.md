---
name: session-handoff
description: Use when pausing in-flight work ("pause", "stop here", "I need to go", context about to compact, session ending), or when resuming or taking over another agent's work from a branch, PR, resume note, or transcript ("pick up where X left off", "continue this branch").
---

# Session handoff

Two halves of one contract. Pausing leaves a checkpoint a cold-start agent can resume from. Picking up reads that checkpoint and resumes without redoing finished work.

## Pause

Only on an explicit pause or a forced stop. "Keep going" and "going to bed, don't stop" mean do not pause (see `autonomous-run`).

1. **Stop at a safe boundary.** Finish the current atomic step or back out of it. Start nothing new. Stop any subagents you launched.
2. **Take no irreversible action to pause.** No new PR and no push to a shared branch unless one was already out.
3. **Make the work durable.** Commit uncommitted edits as one `wip: <what>` commit on the current branch. If the tree does not build, say so in one line of the commit body.
4. **Write the resume note.** Put it at `.agents/handoff/<branch-slug>.md` (keep `.agents/` out of git unless the human wants it committed), or in the PR description if a PR exists. Include:
   - Goal and the exit predicate.
   - What is done and verified, with evidence (commit SHAs, test commands).
   - Current state: branch, worktree path, open PRs, running processes.
   - Next steps, in order.
   - Key files and gotchas.
   - A pointer to the `show-me-your-work` trail if one exists, instead of duplicating it.

Reply with where you are, what is on disk versus only in your head, the commits made, whether the tree is clean, and the first action on resume.

## Pick up

The prior trail is authoritative input. Resist the urge to re-derive it.

1. **Locate the trail.** A resume note in `.agents/handoff/`, the PR body and comments (`gh pr view <n> --comments`), the branch log, a local progress file, or a decision log. For a long transcript, have an `Agent` subagent reduce it to a timeline and keep only the timeline.
2. **Reconstruct state.** Branch and worktree, what landed (`git log main..HEAD`, `git diff main...HEAD`), open todos, decisions made.
3. **Diff done versus planned.** Name the resume point. Do not rerun the prior repro or redo completed work.
4. **Verify inherited claims cheaply.** Run the existing test command or check once on the real artifact. A passing self-report from the prior agent is not proof, but a full redo is not needed either.
5. **Route the remaining work** to the right skill (`autonomous-run`, `babysit-pr`, the plan's next task) and continue.

Reply with where the prior agent stopped, what you inherited versus redid (ideally nothing redone), the resume point, and the outcome.
