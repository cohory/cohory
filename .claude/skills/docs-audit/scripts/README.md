# Docs audit scripts

Run every script from the repository root. Each prints one line per defect and exits 1 when it finds any, so a clean run ends with a `0 defect(s)` line. Python scripts take the repository root as an optional first argument.

| Script | Checks |
|---|---|
| `check-links.py` | Every relative link resolves and every `#anchor` matches a heading, across README.md, AGENTS.md, the root docs, `docs/`, `.github/`, and the Cohory skills. |
| `check-style.py` | No en or em dash, no spaced hyphen in prose, no curly quotes, no emojis, outside code blocks, code spans, and tables. |
| `check-structure.py` | Every doc ends with a labeled "Decisions and open questions" section, every decision record is indexed with the same status, the current release number stays out of the places that go stale, and every doc is linked from somewhere. |
| `lock-hash.mjs` | `skills-lock.json` matches every installed skill folder and no skill is a symlink. |

Third party skills (the folders named in `skills-lock.json`), gitignored folders, and `CODE_OF_CONDUCT.md` are skipped.

## The skills lock

`lock-hash.mjs` reproduces the CLI's hash for every skill except those from `vercel-labs`, which the CLI hashes from its download snapshot. A mismatch there is not proof of drift. The proof is the CLI itself:

1. Copy `.claude/skills` and `skills-lock.json` into a scratch folder and run `git init` there.
2. In that folder run `node <npx cache>/node_modules/skills/dist/cli.mjs update -p -y` (find the cache with `ls ~/.npm/_npx/*/node_modules/skills/dist/cli.mjs`).
3. A skill it reports "already up to date" is consistent. A skill it updates is behind upstream: tell the founder, who runs `npx skills update -p -y` in the repository, because agents are not allowed to download third party content into it.

After any CLI run in the repository, the CLI may install into the gitignored `.agents/skills/<name>` and leave a symlink at `.claude/skills/<name>`. Replace each symlink with a real copy before committing:

```sh
rm .claude/skills/<name>
cp -R .agents/skills/<name> .claude/skills/<name>
```

Then run `lock-hash.mjs` again. Pass `--write` only to adopt hashes the CLI already confirmed.
