---
name: create-verification-skill
description: Use when Cohory has no scripted way to launch the app and prove a feature works the way a user sees it, when asked to "make a verify skill", or when the existing verify-cohory skill or its feature map has drifted from the app ("audit the verify skill"). Generates or maintains .claude/skills/verify-cohory/.
---

# Create or maintain a verification skill

Every agent that claims a feature works needs a scripted way to launch the real app, drive it as a user would, and capture evidence. This skill generates that as a project skill at `.claude/skills/verify-cohory/`, and keeps it honest as the app changes. The reader of the generated skill is the next agent, cold, mid-task.

Run this once the app boots locally (`apps/web` plus Docker Compose services). Until then, there is nothing to verify against.

## Generate

### 1. Interview the repo, not the human

Answer from the codebase. Ask the human only what you cannot observe.

- **Surface.** The primary one is the `apps/web` UI. Note others: route handlers, the Stripe webhook endpoint, background workers.
- **Run.** The documented dev command (root `package.json`, `docker-compose.yml`, README). Ports, env vars from `.env.example`, migrations, seed data, test users and their roles (owner, admin, member, non-member).
- **Drive.** Existing harnesses first (Playwright config and specs). Otherwise a browser automation skill or MCP if available, `curl` for route handlers, the Stripe CLI (`stripe listen`, `stripe trigger`) in test mode for webhooks.
- **Observe.** Screenshots, response bodies, server logs, database rows (`psql` or a Drizzle script), queue job state (pg-boss tables by default).
- **Isolate.** Can two instances run side by side (ports, database names, Compose project names)? If not, say so in the generated skill.

If the checkout does not build or start, fix that first or report it precisely.

### 2. Write the skill

Create `.claude/skills/verify-cohory/SKILL.md` with frontmatter (`name: verify-cohory`, a "Use when" description naming the app and when to use it) and these sections, each filled from what the interview found:

- **Launch.** The exact commands from an empty database to a usable app, including migrations and seed. How to tell it is ready (a log line or a passing health route, not only an open port).
- **Doctor.** One read-only check: services up, correct branch built, port owned by this instance, seed users can sign in.
- **Drive.** Real selectors from this repo. Prefer roles and accessible names, `data-testid`, and route paths over coordinates.
- **Evidence.** What to capture and where (for example `.agents/evidence/<feature>/`). Proof standards: exercise the real user path, not test-only endpoints. Capture the action and the resulting state. Verify side effects (rows written, jobs enqueued, emails captured by a local mail catcher) alongside what is visible. Use Stripe test mode only, never live keys.
- **Cleanup.** Stop what this run started (`docker compose -p <project> down`, kill by recorded PID, never by process name). Evidence survives cleanup.
- **Helpers.** Any script the skill ships is executable and its invocation is shown in the body.

### 3. Seed the feature map

Create `features/README.md` (an index) plus one file per user-facing feature, starting with the top three to five (sign up and sign in, create a post, join a paid community, watch a lesson, earn points). Use the shape in `references/feature-map-example.md`. If seed data lacks a precondition a journey needs, record the failure under that feature's gotchas. Never weaken the journey to make it pass.

### 4. Prove it before handing it over

Run the generated instructions end to end once: launch, doctor, drive one mapped feature, capture evidence, clean up. Confirm the evidence still exists after cleanup. Fix what fails, running cleanup after every failed attempt. An unexecuted verify skill is a draft.

## Maintain

Run periodically or when features change. Outcomes: **clean** (no changes), **changed** (one PR of proven corrections), or **blocked** (say exactly what blocked it).

Edit only `.claude/skills/verify-cohory/`. Never edit product code in this pass. Behavior the map describes that the app no longer does is either doc drift (fix the map) or a product regression (report it).

1. **Index hygiene.** Compare `features/README.md` with the feature files. Fix missing, extra, or dead entries.
2. **Source wave.** One read-only `Agent` subagent per feature file, in one message. Each explains how the feature works from source, flags drift with citations, and returns one live verification recipe. They never drive the app or edit files.
3. **Reconcile.** Merge overlapping recipes. Spot-check cited drift. Look at recent merges (`git log --since`) for user-facing features missing from the map, requiring a concrete source path before calling one missing.
4. **Live pass.** Required even when source looks clean. You drive, serially, one instance. Run doctor before the first drive and after any failed drive. Exercise every feature once. Evidence survives every cleanup. A feature you cannot reach is `unreachable` only with the concrete prerequisite and the route you tried.
5. **Triage.** Wrong description is doc drift (fix it). Working behavior the harness cannot drive is a harness gap (fix it). Broken app behavior is a product bug (report it, keep it out of this PR).
6. **Ship or stop.** For changed, one PR via `opening-a-pr`. For clean or blocked, no PR, report coverage honestly.
