# Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` `check` | Every pull request, push to `main` | Installs with the frozen lockfile, runs the format check, then typecheck, lint, unit tests, the SDK drift check (`check`), and build through turbo. |
| `ci.yml` `integration` | Same | Starts Postgres 17.11, applies migrations with `pnpm db:migrate`, and runs `test:integration` through turbo. |
| `ci.yml` `migration-drift` | Same | Runs `pnpm db:generate` and fails if `packages/db/migrations` changes, so schema edits always ship with their committed migration. |
| `audit.yml` | Pull requests and pushes to `main` that change dependencies, every Monday, manual | Runs `pnpm audit --prod --audit-level high`. Reviewed advisories are listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` with the reason. |
| `e2e.yml` | Pull requests that change more than docs and markdown, push to `main` | Builds the image and runs the Playwright suite and the upgrade path check on Compose. |
| `dco.yml` | Every pull request | Runs `scripts/dco-check.sh` on the pull request's commits and fails when a non merge commit lacks a `Signed-off-by` line for its author's email (Developer Certificate of Origin, see CONTRIBUTING.md). Needs no secrets. |
| `docker.yml` | Push to `main` and `v*` tags, pull requests touching Docker files | Builds the image; on pushes it also publishes it to the GitHub Container Registry. |

On pull requests, `ci.yml` passes `--affected`, so turbo runs only the packages changed against the base branch and their dependents (a change to root config such as `turbo.json` or the lockfile affects every package). Both turbo jobs restore `.turbo/cache` with `actions/cache`, so unchanged tasks replay from the cache. No remote cache service is needed.

Every action is pinned by full commit SHA with the version in a trailing comment. Dependabot (`../dependabot.yml`) proposes monthly minor and patch updates for npm, GitHub Actions (including the SHAs), Docker base images, and Compose images. Major versions are upgraded on purpose. The DCO check skips Dependabot pull requests, since Dependabot cannot sign off.
