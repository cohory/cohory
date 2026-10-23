# Contributing to Cohory

How to propose changes, set up a development environment, and get a pull request merged.

## Ways to contribute

- **Report a bug** with the bug report issue template.
- **Suggest a feature** with the feature request template. Read [mvp-scope](docs/product/mvp-scope.md) first; many ideas are already planned for later phases.
- **Improve the docs.** Fix errors, inconsistencies, or unclear sections. Small fixes can go straight to a PR.
- **Propose an architectural change** by opening a decision record in [docs/decisions](docs/decisions/README.md) as Proposed.
- **Report a security issue** privately. Never in a public issue. See [SECURITY.md](SECURITY.md).

## How to propose changes

1. For anything larger than a typo or a small fix, open an issue or a discussion first. Describe the problem before the solution.
2. Wait for a maintainer to confirm the direction. This avoids work that conflicts with the [principles](docs/foundation/principles.md) or the [roadmap](docs/foundation/roadmap.md).
3. Changes to architecture, data model, authorization, payments, or the license need a decision record. The record is reviewed before the implementation.
4. Open a pull request that references the issue.

## Development setup

Prerequisites:

- Node.js 22 (pinned in `.nvmrc`; `package.json` accepts 22.12 or later within 22)
- pnpm 12 (run `corepack enable` to use the version pinned in `package.json` through `packageManager`)
- Docker with Docker Compose, for PostgreSQL, the test services stack, and the full local stack
- Git

After Docker work, trim the build cache with `docker builder prune -f --max-used-space 3gb` instead of dropping it, so the next build keeps the pnpm store and the Next.js build cache. `scripts/docker-clean.sh` is the full reset: it stops the default `cohory` Compose project, deletes its volumes (your local database), and empties the build cache.

The flow is: clone, `pnpm install`, `cp .env.example .env`, start PostgreSQL (port 5433), run `pnpm db:migrate` and `pnpm db:seed` as separate steps, then `pnpm dev`. The exact commands and the seeded accounts are in the [README](README.md#development), and the day to day loop against the Compose stack (`pnpm stack:dev`) is in [local workflow](docs/open-source/local-workflow.md). Development uses Stripe test mode only.

## Testing your change

The default loop is in [local workflow](docs/open-source/local-workflow.md); full details are in [testing](docs/open-source/testing.md).

- **While you work:** `pnpm verify:changed` checks only the packages changed since `main` and the packages that depend on them (typecheck, lint, unit tests, Prettier on changed files, integration tests). Turbo replays everything whose inputs did not change, so you never need `--force`. Then `pnpm e2e:host <specs>` runs the end to end specs your change touches on the host, without building the Docker image.
- **Before landing:** `pnpm verify` checks every package and runs every integration test, then `pnpm e2e` runs the end to end suite against the production image when the change touches the app.
- **Integration tests** run on the shared test services stack (`pnpm testinfra:up`, PostgreSQL on `127.0.0.1:55432`). Each checkout gets its own database, created when missing and dropped at the end. They refuse the development database on port 5433.
- **Test slots:** heavy commands share one machine wide pool of 2 slots (`COHORY_TEST_SLOTS`). Verify and integration runs take one, `pnpm e2e` and `pnpm e2e:host` take both, so only one e2e run happens at a time. `pnpm e2e` reuses the image for the current source tree when one exists.
- **Docker Desktop:** **Recommendation:** 6 CPUs and 6 GB of memory on an 8 core, 16 GB machine. Nothing enforces it.

## Branches and commits

- Branch from `main`. Names: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`. Scopes are module or package names, for example `feat(courses): add lesson progress`.
- Write the summary in the imperative, under 72 characters. Explain why in the body when it is not obvious.
- Do not add `Co-Authored-By` trailers. Do not mention AI assistants in commits, PR text, or comments.
- Keep history readable. Squash fixup commits before merge.

## Pull request checklist

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) contains the checklist. In short:

- The PR does one thing and links its issue.
- Docs in the same PR describe the change. `docs/product` matches the UI.
- Tests cover the change. Changes to money, auth, permissions, subscriptions, or entitlements must include tests.
- Database migrations follow the rules in [AGENTS.md](AGENTS.md#6-database-migration-rules): forward-only, expand and contract, never edited after merge.
- No secrets, tokens, or real customer data in code, fixtures, or screenshots.
- Evidence of verification (commands and results) is in the `Verification` section. Do not add a "Test plan" section.

## Code review expectations

- **Recommendation:** every PR needs one maintainer approval. PRs touching payments, authorization, tenant scoping, or migrations need two, or one plus a written `blast-radius` analysis while the team is small.
- Reviewers respond within a few working days. If a PR waits longer, a polite ping is welcome.
- Review comments are about the code and the decision, never the person. Explain the reason behind a request.
- Authors respond to every comment, either with a change or a reason. Resolve threads only after agreement.
- Coding agents follow the same rules and also everything in [AGENTS.md](AGENTS.md).

## Documentation conventions

Full rules are in [documentation-conventions](docs/open-source/documentation-conventions.md). The essentials:

- Each doc starts with an H1 title and a one-line purpose.
- Label statements as **Confirmed**, **Recommendation**, **Assumption**, or **Open question**, and end with a "Decisions and open questions" section.
- Do not use dashes as punctuation. Use periods, commas, or parentheses. Hyphens inside compound words are fine.
- No emojis. Use relative links between docs.
- Describe planned features as planned, never as available.

## Developer Certificate of Origin

**Confirmed** (founder, 2026-10-19): every commit in a pull request carries a [Developer Certificate of Origin](https://developercertificate.org/) (DCO) sign-off. There is no Contributor License Agreement (CLA).

The sign-off is one line at the end of the commit message, with your real name and the email of the commit author:

```
Signed-off-by: Ada Lovelace <ada@example.com>
```

`git commit -s` adds it for you. To sign off commits you already made on your branch, run `git rebase --signoff main` and push again. By signing off you certify the DCO 1.1: you wrote the change or have the right to submit it under the project's license, and you understand that the contribution and your sign-off are public and kept with the project.

Contributions are licensed under the license of the part they change: AGPL-3.0 for the core, MIT for `packages/sdk` and `packages/agent-runner` ([LICENSING.md](LICENSING.md)). Because there is no CLA, you keep your copyright, and the project cannot relicense your code without your agreement.

The `DCO` workflow (`.github/workflows/dco.yml`) checks every commit in a pull request and fails, naming the commit, when a sign-off for the commit author's email is missing. Merge commits are skipped.

## Code of conduct

Everyone taking part in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Decisions and open questions

- **Recommendation:** Conventional Commits with module scopes, one approval (two for payments, authorization, tenancy, migrations).
- **Confirmed** (founder, 2026-10-19): DCO sign-off on every commit, no CLA.
- Prerequisites are Node.js 22, pnpm 12, and Docker, as pinned in the repository.
