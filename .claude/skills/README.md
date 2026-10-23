# Cohory agent skills

Project skills for Claude Code agents working on Cohory. Claude Code loads every `SKILL.md` under `.claude/skills/` and invokes a skill when its `description` matches the task. You can also invoke one directly with `/<skill-name>`.

These skills assume the [superpowers](https://github.com/obra/superpowers) plugin is installed. They reference superpowers skills by name (for example `superpowers:writing-plans`) and do not duplicate them.

Most skills were adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack), a Cursor plugin by Lauren Tan. See [Attribution](#attribution).

## Adapted skills

| Skill | Use when | Origin in pstack | What changed |
|-------|----------|------------------|--------------|
| `engineering-principles` | Choosing a data shape, sizing a diff, placing validation, justifying a design choice | The 24 `principle-*` skills | Merged into one index plus `references/principles.md`. Added Cohory examples (membership states, Stripe webhooks, tenant scoping). Linked overlapping entries to superpowers. |
| `typescript-best-practices` | Editing any `.ts` or `.tsx` file | `typescript-best-practices` | Added Next.js, Drizzle, zod, and Stripe rules and examples. Real Postgres in tests. Multi-tenant query scoping. |
| `architect` | Code that crosses a function or package boundary | `architect`, `arena` | Multi-model arena replaced by parallel `Agent` subagents. Added a missing-tenant-scope red flag and package `exports` guidance. Positioned between brainstorming and writing-plans. |
| `prototype` | An undecided layout, interaction, or behavior | `poteto-mode` prototype playbook, `principle-exhaust-the-design-space` | Added Cohory's design direction (colors, radius, spacing, shadcn/ui, Lucide) and required empty, loading, and error states. |
| `how` | "How does X work", placement and ownership questions | `how` | Explore subagents instead of model-routed Task calls. Reads `AGENTS.md` and `docs/architecture/` first. Monorepo placement guidance. |
| `why` | "Why is it built this way", regressions, postmortems | `why` | Cursor MCP discovery replaced by git, `gh`, project docs, vendor docs, and any connected MCP. Trimmed source playbooks. |
| `blast-radius` | "What could this break", risky small diffs | `blast-radius` | Cohory breakage checklist: Drizzle migrations, queued job payloads, server and client boundaries, auth and tenancy, lockfile pins. |
| `interrogate` | Adversarial review of a diff, PR, or sketch | `interrogate` | Model-diverse reviewers replaced by three lens-specialized subagents (correctness, security and tenancy, code quality). Merged rubric, code-quality lens, and lead judgment into one reference. File size threshold lowered to 500 lines. |
| `no-comments` | Before review, to strip narration and workaround comments | `no-comments`, Comment Sicko agent | The persona agent became a plain reviewer prompt. Flags renamed to `RESHAPE`. Constraint encoding proceeds in unattended runs when small and reversible. |
| `technical-writing` | Docs, READMEs, PR bodies, commit messages, SKILL.md files | `technical-writing`, `unslop` | Merged. The slop catalog moved to `references/`. Added house rules: no dashes as punctuation, no emojis, no AI mentions. Parentheses allowed. |
| `opening-a-pr` | Shaping commits and opening a PR | `poteto-mode` opening-a-pr playbook | `gh` only (Origin and built-in PR tool removed). `Verification` section holds evidence, no Test plan. No Co-Authored-By. Monorepo scopes for Conventional Commits. |
| `babysit-pr` | Driving a PR or stack to merge-ready | `poteto-mode` babysit playbook, `bugbot-triage` reference | The `watch-pr` script replaced by `gh pr view` and `gh pr checks --watch`. Triage rubric generalized to any review bot. |
| `shipping` | Landing a verified stack, cutting a release | `poteto-mode` shipping playbook | Cursor cloud verifiers replaced by independent `Agent` subagents. Origin removed. Added a release section that pauses before tags, images, and deploys. |
| `autonomous-run` | Unattended or "don't stop" work | `poteto-mode` autonomous-run playbook, `figure-it-out`, `principle-never-block-on-the-human` | Cursor `/loop` replaced by the `loop` skill and `gh pr checks --watch`. Cohory-specific list of irreversible actions. |
| `session-handoff` | Pausing, or resuming another agent's work | `poteto-mode` pause-safely and session-pickup playbooks | Merged both halves. Resume notes in `.agents/handoff/` or the PR body instead of Cursor transcripts. |
| `show-me-your-work` | Long or unattended runs a human will audit | `show-me-your-work` | Log path moved to `.agents/logs/`. Kept `scripts/log.sh`. Transcript audit simplified to the run's own record. |
| `orchestrate` | A multi-day, many-PR program run by one coordinator | `poteto-mode` orchestrate playbook | The `orch.ts` CLI and Cursor cloud agents replaced by plain TSV files in `.agents/orchestrate/` and worktree-isolated `Agent` subagents. Kept the brief template, standing orders, ledger, and stack safety. |
| `refactoring` | Behavior-preserving structural changes | `poteto-mode` refactoring playbook | Model routing removed. Added codemod guidance and rename sweeps across docs and config. |
| `benchmark-checklist` | Reporting any performance number | `benchmark-checklist` | Web-stack tools: `next build` versus `next dev`, `EXPLAIN ANALYZE`, Core Web Vitals. |
| `create-verification-skill` | No scripted way to prove app behavior, or the verify skill drifted | `create-verification-skill`, `maintain-verification-skill` | Merged generation and maintenance. Targets `.claude/skills/verify-cohory/`. Cohory journeys, seed roles, Stripe test mode, and Compose cleanup. |
| `correct` | Repeated corrections, or capturing lessons after a long task | `correct`, `reflect` | Merged. Uses `.learnings/`, `AGENTS.md`, and ESLint rules. Skill edits still wait for human approval. |

## Skipped pstack skills

| Skill | Reason |
|-------|--------|
| `poteto-mode` | A personal router tied to Cursor modes and model slugs. Its useful rules live in the skills above and in the workflow chain below. |
| `poteto-help`, `setup-pstack`, `automate-me` | Cursor setup, model configuration, and personal mode authoring. |
| `make-bot-ui` | Cursor Grok Bot webhook dashboards. Irrelevant to Cohory. |
| `tdd` | Duplicates `superpowers:test-driven-development`. |
| `swarm` | Duplicates `superpowers:dispatching-parallel-agents`. Its brief and verdict rules moved into `orchestrate`. |
| `arena` | Folded into `architect` (design twice, pick a base, graft). |
| `figure-it-out` | Covered by `superpowers:writing-plans` plus `autonomous-run`. |
| `recall`, `ketchup` | Depend on Cursor transcript storage. `session-handoff` covers the resume case. |
| `teach`, `bro`, `sharpen`, `in-your-own-words` | Conversational style aids, not engineering workflow. |
| Playbooks: bug fix, feature, multi-phase plan | Duplicate `superpowers:systematic-debugging`, `superpowers:brainstorming` with `superpowers:writing-plans`, and `superpowers:subagent-driven-development`. Their distinct rules (failing repro committed before the fix, throughput checkpoint) are in `opening-a-pr`, `engineering-principles`, and `orchestrate`. |
| Playbooks: hillclimb, perf issue, runtime and trace forensics, visual parity, eval, worktree cleanup, autopilot full and stack, authoring a skill | Niche or Cursor-specific. `benchmark-checklist` covers perf numbers, `superpowers:writing-skills` covers skill authoring, and `orchestrate` covers autopilot programs. |
| Benny automation pack (`triage-issue-reports`, `reproduce-and-fix-issues`, `setup-benny`) | Runs only on Cursor automations. |

## Recommended workflow chain

For a typical feature, such as "members can bookmark posts":

1. `superpowers:using-superpowers` at session start. Read `AGENTS.md` and the relevant `docs/architecture/*.md`.
2. `superpowers:using-git-worktrees` to get an isolated branch.
3. `how` over the affected packages. `why` if the design touches code whose reasons are unclear.
4. `superpowers:brainstorming` to settle what to build. `prototype` if the UI or interaction is undecided.
5. `architect` to settle caller usage, types, tables, and package placement.
6. `superpowers:writing-plans` to sequence the work into verifiable units.
7. `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) with `superpowers:test-driven-development`, `typescript-best-practices`, and `engineering-principles` applied to every task. `superpowers:systematic-debugging` when something fails.
8. `blast-radius` for migrations, shared types, auth, or payment changes. `interrogate` for contested or high-risk diffs. `superpowers:requesting-code-review` for the standard review.
9. `no-comments`, then `superpowers:verification-before-completion`. Use `verify-cohory` (from `create-verification-skill`) to prove the feature in the running app.
10. `superpowers:finishing-a-development-branch`, then `opening-a-pr` with `technical-writing` for the commits and PR body.
11. `babysit-pr` to reach merge-ready, `superpowers:receiving-code-review` for human feedback, and `shipping` when the human says land it.
12. `correct` if the human had to correct the same thing twice.

For unattended work, wrap steps 5 to 11 in `autonomous-run` with a `show-me-your-work` trail, and use `session-handoff` if the session must stop. For a program of many features, a coordinator runs `orchestrate` and hands each worker a brief that names the skills above.

## Third party skills

These skills are copied unchanged from other projects and keep their own licenses (MIT for most, CC-BY-SA-4.0 for `supply-chain-risk-auditor`, and no stated license for the two Better Auth skills). Sources, copyright holders, and license texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

| Skill | Source |
|-------|--------|
| `code-review`, `codebase-design`, `improve-codebase-architecture` | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `hono` | [honojs/skills](https://github.com/honojs/skills) |
| `playwright-best-practices` | [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) |
| `security-audit` | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) |
| `stripe-best-practices` | [stripe/ai](https://github.com/stripe/ai) |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) |
| `turborepo` | [vercel/turborepo](https://github.com/vercel/turborepo) |
| `vitest` | [antfu/skills](https://github.com/antfu/skills) |
| `vercel-react-best-practices`, `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `supply-chain-risk-auditor` | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `better-auth-best-practices`, `better-auth-security-best-practices` | [better-auth/skills](https://github.com/better-auth/skills) |

[skills-lock.json](../../skills-lock.json) lists every installed skill with its source. The two Better Auth skills come from a repository that states no license; the notices file says how they are included.

## Attribution

Many skills in this directory are adapted from pstack by Lauren Tan, published in [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) at commit `0317eb8b858c991c57721358daaee19dbe8c814d`. pstack is released under the MIT License. The original copyright and permission notice is reproduced in [`LICENSE-pstack`](LICENSE-pstack), as the license requires. The adaptations (rewrites for Claude Code, the Cohory stack, and its conventions) are part of Cohory.
