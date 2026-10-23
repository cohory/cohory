---
name: why
description: Use when asked "why does X work this way", "why did we pick Y", "why is this check here", for design rationale before changing code, for regressions, or for postmortems. Investigates git history, PRs, issues, and docs and returns a cited answer that separates fact from inference.
---

# Why

Find the forces that gave code its shape. The `how` skill explains what the code does. This skill explains why.

Be a careful investigator. Separate what you found from what you infer, and say what you could not find.

## 1. Pin the target and the question

The target is a file range, symbol, pattern, or decision. The question is a rationale, a tradeoff, a motivating edge case, or a history sweep. If the target is vague, state your best guess from context and proceed.

## 2. Build the code anchor

```bash
git blame -L <start>,<end> <file>
git log --follow --oneline -20 -- <file>
git log --follow -p -- <file>
git log -1 --format=%B <commit>
gh pr view <number> --json title,body,author,mergedAt,labels,closingIssuesReferences,comments,reviews
gh issue view <number> --json title,body,comments
```

Collect paths, symbols, the commits that touched the target, PR numbers (look for `(#123)` in subjects), and linked issues.

## 3. Search each evidence source

Cover every source that exists. A null result is a finding, so record it.

- **Source control.** Commits, PR bodies, review threads, code comments, tests that pin the behavior.
- **Issues.** `gh issue list --search "<terms>" --state all`.
- **Project docs.** `docs/architecture/*.md`, ADRs, `AGENTS.md`, a local progress file if one exists, READMEs, `CHANGELOG.md`.
- **External constraints.** Vendor docs for Stripe Connect, Better Auth, Next.js, or Drizzle when the code looks shaped by a library contract. Note the version from the lockfile.
- **Connected tools.** If MCP servers for an issue tracker, chat, or error tracking are available in this session, search them too. If not, list them as unavailable.

If the target looks defensive (null checks, retries, timeouts, rate limits, feature flags), look specifically for the incident or bug report that motivated it.

For a wide sweep, spawn one `Agent` subagent per source in a single message and synthesize their findings yourself.

## 4. Answer

- **The question.**
- **The code in question.** Paths and lines.
- **What we found.** Facts, each with a citation (commit SHA, PR number, issue, doc path).
- **What we can reasonably infer.** Labeled as inference, with the evidence it rests on.
- **Competing hypotheses.** When the evidence supports more than one story.
- **What we do not know.**
- **Sources consulted.** One line per source, including the ones that returned nothing and the ones unavailable.

If the question precedes a change, end with a short constraint set: **Preserve** (what the original reason still requires), **Change** (what no longer applies), **Avoid**, **Risk**.

## Failure modes

- Recency bias. The latest commit is not automatically the reason. Trace back.
- Treating a plausible story as fact. Label inference as inference.
- Inventing a PR, issue, or quote. Never.
