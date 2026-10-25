# Reviewer brief

Send one copy per reviewer with the placeholders filled in: the repository path and branch, a scratchpad prefix (`a-`, `b-`, `c-`), the file set from section 3 of the skill, and the known facts (what the scripts and your own checks established, plus founder answers already given). Keep the rest verbatim; every sentence closes a gap a reviewer fell into.

```
You are doing an independent verification pass of a documentation audit in the Cohory monorepo at <repo path> (branch <branch>; the working tree has uncommitted doc edits). Do NOT commit, stage, stash, or run git write commands. Do NOT run pnpm, docker, or any build or test command. Read only shell, plus file edits with the Edit tool. Use the scratchpad prefix <prefix>- for any helper script you write, and never trust a script file you did not just write.

Your file set, and only these (other reviewers own the rest):
<list>

Never edit: third party skills (the folders named in skills-lock.json), CODE_OF_CONDUCT.md, gitignored folders, and the Context, Decision, or Consequences of an Accepted decision record (status line and links only). Dated records (docs/security/review-*.md, docs/research/) get link and style fixes only.

What to verify, claim by claim, against the actual code, not against other docs:
1. Every file path, package name (packages/*/package.json "name" and "exports"), pnpm script, env variable (.env.example, .env.production.example, packages/config), Compose service and profile, worker CLI command, workflow name, job name and cron string, table, column, index, RLS setting, route, permission and scope name, UI label, quoted copy, count, and worked fee example exists and is described correctly. grep the code to confirm. Fix wrong ones.
2. Internal markdown links and anchors resolve. A section cited by number in another doc exists with that number.
3. Nothing is described as built that is not in the code, and nothing built is called planned or Proposed.
4. House style: plain English, no dashes used as punctuation (no em dash, en dash, or spaced hyphen in prose; hyphens inside words and minus signs in code are fine), no emojis, sentence case headings (proper nouns keep their case), straight quotes, no filler. Every doc in your set ends with a "Decisions and open questions" section with labeled bullets (Confirmed, Recommendation, Assumption, Open question). The current release number appears only in CHANGELOG.md, decision records, decisions-log.md, dated reviews, and env examples; elsewhere write "today" or "not built yet".
5. Do not change meaning, scope, or decisions. Do not answer founder open questions. Do not add new content sections beyond fixing defects.

Known facts for this pass:
<facts: fee rate, image visibility, record statuses accepted today, scope moves>

Fix every defect you confirm with the Edit tool, keeping edits minimal. Report back in this form:
- Fixed: one line per edit, "path:line, what was wrong, what it says now".
- Not fixed (needs a person): one line each with why.
- Verified clean: the files you checked that needed no change.
Be concrete and skeptical; never report "looks fine" without having grepped the code for the claim.
```

After the reports come back:

- Spot check two fixes per reviewer against the code before trusting the rest.
- Items under "Not fixed" are either yours (section 4 of the skill) or the founder's (section 5). Nothing stays in limbo.
- Log anything a reviewer found that the scripts should have caught, and extend the scripts.
