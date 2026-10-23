# 0044. One composition root per process, typed session settings, one logger, and one definition per job

Each process builds its default services in one wiring module, row level security settings go through one typed module in `@cohory/db`, every process logs through `@cohory/infra/logger`, and each worker job is one definition object.

Status: Accepted, 2026-10-23

- ADR status: Accepted
- Date: 2026-10-23
- Deciders: coordinator as product owner under the founder's mandate (review of 2026-10-21)
- Related: [0031](0031-community-access-module.md) (decision 1 wiring and the planned direction are superseded here), [0005](0005-postgres-job-queue.md), [../architecture/overview.md](../architecture/overview.md) sections 3, 7, and 14, [../architecture/multi-tenancy.md](../architecture/multi-tenancy.md) section 3.4, AGENTS.md section 2

## Context

The architecture review of 2026-10-21 found four structural problems that each made a safe change harder than it needed to be.

- **Session settings.** About 90 calls to `set_config('app.…', …)` were spread over the domain packages, each with its own string name and a `*Setting` constant or a local `enable()` helper. A typo in a flag name fails open into a policy that silently denies, and nothing tied the names to the policies in the migrations.
- **Wiring.** Default services were built in several places. `@cohory/courses/entitlements` built the agent delegation service, so `@cohory/courses` depended at runtime on agents, notifications, and payments ([0031](0031-community-access-module.md) consequences). The web app kept its own posts singleton with the notifications publisher, the API filled missing route dependencies with `?? getX()` fallbacks, and the worker built a second copy of courses and posts per job factory.
- **Logging.** The worker used pino while the web app, the API, and the domain packages called `console` directly. Only the worker redacted secrets (security review L-02).
- **Jobs.** Each worker job was registered in three places (queue creation, `work`, and `schedule`) and logged from a hand written list that had drifted: four queues were missing from the startup log.

The review also flagged `restoreArchive` (about 1,300 lines in one function) and eight files over the 500 line limit in AGENTS.md section 3.

## Decision

1. **One typed module for session settings.** `packages/db/src/tenancy/session.ts` lists every flag (`rlsFlags`) and value (`rlsValues`) the policies read, and is the only code that calls `set_config`. Callers use `setRlsFlag`, `setRlsFlags`, `setRlsValue`, `setMemberRemovalReason`, `readRlsSetting`, and `withRlsFlags` (which restores the previous values afterwards), or pass `{ userId, flags }` to `runInCommunity`. A test checks that the two lists equal the settings the migrations read and that no other source file calls `set_config`.
2. **One composition root per process.** `@cohory/api/services` builds the default entitlements, courses, posts (with the notifications publisher after commit), and search services once per process, and `apiDeps(overrides)` gives every route its dependencies. The web app imports the same module, so a Next.js server shares one instance with the API it mounts. The worker builds its own in `apps/worker/src/services.ts`. Route dependencies are required; there are no fallbacks inside routes. The courses default service takes the agent access port by injection (`createDefaultCoursesService({ agentAccess })`), and `@cohory/courses/entitlements` is removed, so courses keeps agents, notifications, and payments as development dependencies only.
3. **One logger.** `packages/infra` now exists and exports `@cohory/infra/logger`: JSON lines with level, time, service, message, and fields; `password`, `token`, `secret`, `authorization`, and `cookie` redacted at any depth; errors serialized; `child` loggers; `LOG_LEVEL` from the environment. The worker wraps it and pino is removed. An ESLint `no-console` rule covers package sources, the web app, and the worker, with exemptions for tests, command line entry points, the logger itself, migration and seed scripts, the log email driver, and `packages/ui`.
4. **One definition per job.** Each file under `apps/worker/src/jobs` exports `JobDefinition` objects: a name, queue and work options, a handler that receives `{ logger, deps, options }`, and either a cron schedule or a Zod `payloadSchema`. `worker.ts` holds the list and one `registerJobs` loop creates, works, and schedules them and derives the startup log. Payloads stay ids only.
5. **Split by sub area.** `restoreArchive` is a short orchestrator over one module per phase (`packages/migration/src/import/restore-*.ts`) sharing a `RestoreContext`. The Postgres repositories of payments, posts, and Manage, the agents, approvals, and reviews services, and the Manage routes are split by sub area into stores, method groups, or route modules, following `packages/payments/src/service/`.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep string setting names and add a lint rule | No API change | A lint rule cannot check names against the policies | The typed list plus a test against the migrations closes both gaps |
| A dependency injection container | One place for every service | A new dependency and indirection for about six services | Plain lazy getters are enough |
| Keep the wiring in `@cohory/courses/entitlements` | No caller changes | Courses keeps three runtime dependencies it does not use | Superseded as 0031 planned |
| Share pino with every process | Mature, fast | A Node only dependency in packages the web bundle imports, and a second API to learn | A 100 line logger covers the needs; pino can return behind the same interface |
| Leave the large files | No churn | Reviews and merges keep touching one file | AGENTS.md sets the limit |

## Consequences

- Positive: a new policy setting is one entry in a typed list, and a misspelled flag no longer compiles. Tenant isolation is unchanged; the RLS and cross tenant integration suites pass on the new module.
- Positive: one instance of each default service per process, and tests override any of them through `apiDeps({ … })`.
- Positive: every process redacts secrets in logs, which closes security review finding L-02.
- Positive: adding a job is one definition in one file; the startup log can no longer drift.
- Negative: the composition root lives in `@cohory/api`, so the web app depends on it for wiring as well as for routes. A separate wiring package would add a package for four getters.
- Negative: split services keep a context object (`createAgentsContext`, `createApprovalsContext`, `createReviewsContext`) that the method groups destructure; reading one method means opening the context too.
- Follow up: `packages/infra` holds only the logger. Queue, storage, and email adapters stay in their packages until a change gives a reason to move them.

## Open questions

None.
