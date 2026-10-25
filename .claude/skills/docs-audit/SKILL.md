---
name: docs-audit
description: Use when preparing a release, when asked to "audit the docs", "check the documentation", "simplify the docs", or "are the docs still right", or when a doc describes something the code no longer does. Covers README.md, AGENTS.md, docs/, decision records, GitHub templates, the skills README, and skills-lock.json.
---

# Docs audit

Bring every document back in line with the code, make it shorter, and leave nothing for the next release to fix. The audit is a loop: mechanical checks, claim checks against the code, fixes, founder decisions, mechanical checks again, then one PR.

The founder reviews before anything is committed. Nothing is committed until they say how.

## 1. Set up

1. Branch off `main` (`docs/audit-<yyyy-mm>`). Never audit on `main`.
2. Read `docs/open-source/documentation-conventions.md` and section 8 of `AGENTS.md`. They are the rules you enforce.
3. Fix the scope. In: `README.md`, `AGENTS.md`, the root docs (`CONTRIBUTING.md`, `GOVERNANCE.md`, `LICENSING.md`, `SECURITY.md`, `CHANGELOG.md`), `.github/`, `docs/` with `docs/decisions/`, `.claude/skills/README.md`, the Cohory skills (every folder under `.claude/skills` that `skills-lock.json` does not name), and `skills-lock.json`. Out, never edited: third party skills (the folders `skills-lock.json` names), `CODE_OF_CONDUCT.md`, gitignored folders such as `docs/superpowers/` and `.agents/`, and the body of an Accepted decision record.
4. Dated records (`docs/security/review-*.md`, `docs/research/`) get link and style fixes only.
5. Helper scripts and notes go in the session scratchpad (the scratch directory the harness names in its environment, or a temporary folder outside the repository). Never in the repository.

## 2. Mechanical checks

Run from the repository root. Each script prints one line per defect and exits non zero when it finds any.

```sh
python3 .claude/skills/docs-audit/scripts/check-links.py
python3 .claude/skills/docs-audit/scripts/check-style.py
python3 .claude/skills/docs-audit/scripts/check-structure.py
node .claude/skills/docs-audit/scripts/lock-hash.mjs
```

They cover: relative links and heading anchors; dashes as punctuation, curly quotes, and emojis outside code (the `## [x.y.z] - date` changelog headings are the one allowed spaced hyphen); every doc ending with a "Decisions and open questions" section; every decision record indexed with the same status as its status line; current release numbers outside the places that may carry them; every doc linked from another doc; and the skills lock against the installed folders. The three Python scripts end with a `N defect(s)` line; `lock-hash.mjs` ends with one summary line and exits 1 only for stale entries or symlinks. A skill it lists under "only the CLI can verify" counts as clean once the CLI check in `scripts/README.md` reinstalls it without changing a file. Read that README for the rest.

## 3. Claim checks against the code

Scripts cannot tell that a doc calls a built feature planned. Three reviewers do, in parallel, with disjoint file sets and read only access to the code:

- A: `README.md`, `AGENTS.md`, the root docs, `.github/`, `docs/README.md`, `docs/self-hosting.md`, `docs/operations/`, `docs/open-source/`, `.claude/skills/README.md`, and the Cohory skills.
- B: `docs/architecture/`, `docs/security/`, `docs/decisions/`.
- C: `docs/product/`, `docs/foundation/`, `docs/brand/`, `docs/research/`.

Brief each one with `references/reviewer-brief.md`. Fill its placeholders from what you established yourself in sections 1 and 2 and from any founder answers already given; a reviewer gets facts, never guesses. Every claim is checked by grep against the code, never against another doc: paths, package names, scripts, env variables, jobs and cron strings, tables and columns, routes, permissions, UI labels and quoted copy, counts, worked fee arithmetic, and section numbers cited in other docs. Reviewers fix what they confirm and report fixed, not fixed with the reason, and verified clean.

Give each reviewer its own file prefix in the scratchpad. Two reviewers sharing one script name overwrite each other.

## 4. Fixes you make yourself

- Simplify: rewrite a doc over about 500 lines to the as-built shape, move how-to out of architecture docs into `docs/operations/`, and delete repeated passages. Keep section numbers that other docs cite, or repoint every citation in the same change.
- Release numbers: the current version appears only in `CHANGELOG.md`, decision records, `decisions-log.md`, dated reviews, and env examples. Elsewhere write "today", "not built yet", or "as built". History such as "since 0.8.0" may stay.
- An Accepted record: change its status line and links only. Correct a wrong Consequences or Summary with a short superseding record and point the status line at it.
- Labels: `Confirmed`, `Recommendation`, `Assumption`, `Open question`, nothing else. "Draft" and "Decided" are not statuses.
- When a code fact contradicts two docs that disagree, the code wins. Write what the matrix, the schema, or the route does.

## 5. Founder decisions

You do not decide product questions. Collect everything that needs the founder in one file outside the repository, for example `~/cohory-backups/cohory-open-items-<date>.md`: the open questions, to-dos, and unapplied recommendations the docs themselves list (each ending with its source path), plus what the audit raised. The audit raises three kinds of decision: a decision record still Proposed although its feature is in the code, a requirement whose priority no longer matches what is built (for example an MVP item nobody started), and a setting only the founder can change (package visibility, a license, a default). Ask once, with options. Apply the answers: status lines and the index, the decisions log, the requirement tables, and the open items file.

Dangerous actions wait for the founder: deleting records, making a package or repository public, changing a license, or any download of third party content into the repository (the permission classifier blocks skill updates for agents; the founder runs `npx skills update -p -y` and you verify, see `scripts/README.md`).

## 6. Finish

1. Rerun section 2. All four scripts must be clean.
2. Run `pnpm verify:changed`.
3. Present the diff for review and wait. Then commit once with sign off, no attribution trailers, and open the PR with `opening-a-pr`. The Verification section carries the last line of each script, one line per reviewer (file set, number of fixes, anything left for the founder), and the `pnpm verify:changed` result.

## Red flags

| Thought | Reality |
|---|---|
| "The doc says it is built, so it is" | Only the code says what is built. Grep it. |
| "I will update the version number to the new release" | Remove it instead. A number outside the allowed places is a defect. |
| "This Accepted record is wrong, I will fix the paragraph" | Status line, links, or a superseding record. Nothing else. |
| "I will just decide this scope question" | Founder decision. Put it in the open items file. |
| "A regex up to the next period will remove the sentence" | It stops at the dot in `ghcr.io`. Replace exact text and print the changed line. |
| "The lock hash is wrong, I will recompute it" | Only the CLI's own run is proof. Replicas miss vercel-labs skills. |
| "The skills CLI finished, commit" | It may have left symlinks into the gitignored `.agents/skills`. Replace them with real folders first. |

## Common mistakes

- A plural in a regex (`records` versus `record`) silently skips a line. Assert the replacement count.
- Counting tools or specs from another doc instead of the snapshot test or the folder.
- Quoting UI copy from a plan instead of the component.
- Converting third party skill headings to sentence case. Those files are copied unchanged.
- Treating "Decisions and open questions" as satisfied when a later section follows it. It must be the last heading.
