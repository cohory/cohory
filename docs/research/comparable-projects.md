# Comparable Open-Source Projects: Research for Cohory

Ten open-source products that overlap with cohory, and the patterns to reuse or avoid.

Status: Draft, 2026-10-17

Research date: 2026-10-17. Star counts are approximate and were read from the GitHub API on that date. Facts that could not be confirmed against a primary source are marked "unverified".

## Purpose and method

Cohory is an open-source community platform for creators (community feed, courses, calendar, members, gamification, creator-owned Stripe subscriptions, 2% cloud fee ([ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md)), Docker Compose self-hosting, REST + OpenAPI + MCP). This document studies ten open-source products whose stack or problem space overlaps with ours and extracts patterns we can reuse or should avoid.

Method:

- Repository metadata, licenses and directory trees were read with `gh api repos/OWNER/REPO/...` (contents, git trees, raw files).
- Key `package.json` files were scanned for ORM, auth, queue, email, i18n, analytics, test and MCP dependencies.
- Architecture docs (for example Documenso `ARCHITECTURE.md`), license files, `ee` folders and license-check code were read directly.
- Stripe Connect behavior was verified against docs.stripe.com pages fetched on the research date.

## Selection

| # | Project | Why it was selected |
|---|---------|---------------------|
| 1 | Cal.com / Cal.diy | Next.js + Prisma + Turborepo SaaS, Stripe Connect OAuth for hosts, app store plugin model, and a fresh (April 2026) case study of an open-core company closing its source |
| 2 | Dub | Next.js + Prisma monorepo, `(ee)` route-group split, Stripe Connect payouts, OpenAPI generated from Zod, hosted MCP |
| 3 | Documenso | Clean modular monorepo with an architecture doc, swappable providers (jobs, storage, email), license-key-gated EE package |
| 4 | Formbricks | Better Auth in production, MCP route with OAuth dynamic client registration, `modules/ee` with license check, Docker Compose + Helm |
| 5 | Twenty | Large AGPL TypeScript app, schema-per-tenant Postgres, BullMQ worker from the same image, built-in MCP, AGPL application exception |
| 6 | Midday | Drizzle + Postgres, Hono + `@hono/zod-openapi` REST, tRPC, first-class MCP server, Trigger.dev + BullMQ |
| 7 | Ghost | The reference for creator memberships with creator-owned Stripe accounts and 0% platform fee; Stripe Connect OAuth relay usable by self-hosters |
| 8 | LearnHouse | Direct competitor in courses (listed in our competitor table), open-core payments, CLI-first self-hosting |
| 9 | Discourse | The incumbent self-hosted community; plugin architecture; bundled gamification and Stripe subscription plugins; MCP client |
| 10 | Payload CMS | Next.js-native, MIT, Drizzle-based Postgres adapter, config-transform plugin model, official MCP and multi-tenant plugins |

Considered and not selected (briefly referenced in the synthesis): Papermark (AGPL + `ee/`, very similar to Dub), Trigger.dev (Apache 2.0, job platform), Plane, Rallly, Novu, Unkey, OpenStatus, Hoppscotch, Infisical, Postiz, Frappe LMS, Rocket.Chat, Flarum, Supabase, Maybe Finance.

---

## 1. Cal.com (now Cal.diy for the public repo)

| Field | Detail |
|-------|--------|
| Repo | https://github.com/calcom/cal.diy (the old `calcom/cal.com` URL redirects here) |
| License | MIT (changed from AGPL 3.0 in April 2026) |
| Stars | about 49k (stars carried over from the original repo) |
| Stack | Next.js 16, React, tRPC, Prisma (plus Kysely), Tailwind 4, NestJS for API v2, Yarn workspaces + Turborepo |
| Layout | `apps/web`, `apps/api/v2`, `apps/docs`; `packages/features`, `packages/app-store`, `packages/prisma`, `packages/trpc`, `packages/ui`, `packages/emails`, `packages/i18n`, `packages/platform`, `packages/embeds`, `packages/lib` |

- Modules and domains: business logic lives in `packages/features/<domain>` (bookings, availability, schedules, webhooks, flags, credits, membership, onboarding and more than 50 others). Integrations live in `packages/app-store/<app>` (about 150 apps), each with its own `api/`, `lib/`, `components/` and metadata.
- Auth: NextAuth v4 (`next-auth` 4.24 in `apps/web`), API keys and platform OAuth clients for API v2.
- DB and migrations: Prisma schema in `packages/prisma` with checked-in SQL migrations (more than 1,100 files under migrations and schema). Kysely is also present for hand-tuned queries.
- Multi-tenancy: row-level via users, teams and organizations (organizations add subdomains). Teams and organizations were removed from the MIT Cal.diy fork and are now commercial only.
- Payments: the `stripepayment` app uses Stripe Connect OAuth (`stripe.oauth.token`) and stores `stripe_user_id` as an app credential. Charges are created with `stripeAccount: credentials.stripe_user_id`, which means direct charges on the host's own account (verified in `packages/app-store/stripepayment/lib/PaymentService.ts`).
- Core vs commercial: historically `packages/features/ee` plus a license key. In April 2026 Cal.com moved its production codebase to a private repository and published Cal.diy, an MIT community edition with all enterprise code (teams, organizations, routing forms, workflows, insights, SAML SSO, API v1) removed. Source: https://cal.com/blog/cal-diy-open-source-to-closed-source
- Self-hosting: root `Dockerfile`, `docker-compose.yml`, `deploy/install.sh`, Railway/Render style `app.json`. The Cal.diy README now warns it is "strictly recommended for personal, non-production use".
- API and agents: API v2 is a NestJS app with Swagger generation (`apps/api/v2/src/swagger`, `docs/api-reference/v2/openapi.json`). A hosted MCP server at `https://mcp.cal.com/mcp` uses Streamable HTTP with OAuth 2.1 and wraps API v2 (source: https://cal.com/docs/mcp-server). `@modelcontextprotocol/sdk` is a root dependency.
- Testing: Vitest (workspace config), Playwright E2E, Jest for API v2, Checkly synthetic checks (`__checks__`).

Lessons for cohory:

1. The app-store pattern (one folder per integration with metadata, API handlers and UI) is a proven way to grow a plugin ecosystem inside a monorepo before a public SDK exists.
2. Direct charges on a Connect OAuth account (`Stripe-Account` header) is exactly the creator-ownership model we want, and Cal.com has run it at scale.
3. Open-core with a large, entangled `ee` surface is fragile. Cal.com ended up closing source. Keep the commercial surface small and clearly separable, or do not have one.
4. A public "do not use in production" warning on the community edition hurts trust. Cohory's self-host edition must be production grade.

---

## 2. Dub

| Field | Detail |
|-------|--------|
| Repo | https://github.com/dubinc/dub |
| License | AGPL 3.0 for most code; a commercial license for `apps/web/app/(ee)` and `apps/web/app/app.dub.co/(dashboard)/[slug]/(ee)` |
| Stars | about 25k |
| Stack | Next.js 15 (App Router), Prisma 6 on MySQL (PlanetScale), Upstash Redis + QStash, Tinybird analytics, NextAuth v4, Tailwind 3, pnpm + Turborepo |
| Layout | `apps/web` only; `packages/ui`, `packages/utils`, `packages/email`, `packages/embeds`, `packages/cli`, `packages/stripe-app`, `packages/hubspot-app`, `packages/tinybird`, `packages/workers`, `packages/tailwind-config`, `packages/tsconfig` |

- Modules and domains: one large Next.js app. Domain logic lives under `apps/web/lib/<domain>` (links, partners, payouts, commissions, rewards, webhook, stripe, openapi and many integration folders). Multiple products are separated by hostname route groups (`app.dub.co`, `partners.dub.co`, `admin.dub.co`).
- Auth: NextAuth v4 with Prisma adapter; SAML/SSO via BoxyHQ Jackson (`lib/jackson.ts`); SCIM in `(ee)`.
- DB and migrations: Prisma multi-file schema (`apps/web/prisma/schema/*.prisma`), `relationMode = "prisma"` because PlanetScale does not enforce foreign keys. Uses `prisma db push` style workflows (unverified).
- Multi-tenancy: row-level workspaces (the `Project` model with `slug`), plan capabilities in `lib/plan-capabilities.ts`.
- Payments: Stripe for SaaS billing. Stripe Connect for partner payouts with webhook handlers for `account.application.deauthorized`, `account.updated`, `payout.paid` and newer Accounts v2 "outbound payment" events (`app/(ee)/api/stripe/connect/v2/webhook/*`). Also PayPal payouts.
- Core vs commercial: Next.js route groups named `(ee)` hold enterprise code. The `(ee)/README.md` states you may not host your own app.dub.co with that code without a license. No runtime license key; the split is legal, not technical (unverified that no key exists).
- Self-hosting: officially documented, but requires Vercel, PlanetScale, Upstash, Tinybird and Cloudflare or AWS accounts (https://dub.co/docs/self-hosting). `apps/web/docker-compose.yml` is explicitly "local development only". Community Railway templates fill the gap.
- API and agents: OpenAPI generated from Zod (`zod-openapi`, `openapi3-ts`, one file per operation under `lib/openapi/<resource>/`). SDKs generated from the spec (Speakeasy, unverified). Official hosted MCP servers at `mcp.dub.sh` for partners and links (https://dub.co/docs/mcp-server).
- Testing: Vitest API tests (`apps/web/tests`) and Playwright.

Lessons for cohory:

1. One OpenAPI operation file per endpoint, generated from the same Zod schemas used for validation, keeps docs, SDKs and MCP tools in sync.
2. Handling `account.application.deauthorized` and `account.updated` from day one is table stakes for Connect.
3. A self-host story that depends on five SaaS vendors is not self-hosting. Every external service in cohory must have a local default (Postgres, Redis, MinIO or local disk, SMTP).
4. Splitting by legal folder only (`(ee)`) is cheap to implement but invites confusion about what self-hosters may run.

---

## 3. Documenso

| Field | Detail |
|-------|--------|
| Repo | https://github.com/documenso/documenso |
| License | AGPL 3.0, with `packages/ee` under a commercial license |
| Stars | about 15k |
| Stack | React Router v7 (Remix) on a Hono server, Prisma 6 + Kysely on Postgres 15, tRPC 11 with OpenAPI, ts-rest (legacy v1), Lingui i18n, React Email, Tailwind + shadcn/ui + Radix, npm workspaces + Turborepo |
| Layout | `apps/remix`, `apps/docs`, `apps/openpage-api`; `packages/lib`, `packages/trpc`, `packages/api`, `packages/prisma`, `packages/ui`, `packages/email`, `packages/auth`, `packages/signing`, `packages/ee`, `packages/app-tests`, `packages/assets` |

- Modules and domains: `packages/lib` is the core with `server-only/`, `client-only/` and `universal/` subfolders. API routers are grouped per domain (`document-router`, `template-router`, `envelope-router`, and so on). A checked-in `ARCHITECTURE.md` documents all of this for humans and agents.
- Auth: in-house `packages/auth` using Arctic for OAuth providers and `@simplewebauthn/server` for passkeys (no NextAuth or Better Auth).
- DB and migrations: Prisma schema and SQL migrations in `packages/prisma/migrations` (dated folders such as `20240205040421_add_teams`), Kysely for complex queries.
- Multi-tenancy: row-level organisations and teams.
- Payments: Stripe billing for the hosted product. "The Stripe Billing Module" is listed in `packages/ee/FEATURES` as commercial.
- Core vs commercial: `packages/ee` plus a runtime license key `NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY` checked against `https://license.documenso.com` with a cached license file (`packages/lib/server-only/license/license-client.ts`). E2E tests cover enterprise restrictions and a license status banner. `IS_BILLING_ENABLED` separates cloud from self-hosted behavior. Contributors sign a CLA (`CLA.md`).
- Self-hosting: `docker/production/compose.yml`, `docker/development/compose.yml`, plus `railway.toml` and `render.yaml` one-click configs. Docs at `apps/docs/content/docs/self-hosting`.
- Swappable providers selected by env var: jobs (`local` database queue by default, `bullmq`, `inngest`), storage (`database`, `s3`), email (`smtp-auth`, `smtp-api`, `resend`, `mailchannels`), signing (`local`, `gcloud-hsm`).
- API and agents: API v2 is tRPC exposed as OpenAPI (`trpc-to-openapi`) under `/api/v2`; internal tRPC under `/api/trpc`. MCP not found in the repo (unverified whether a hosted one exists).
- Testing: Playwright E2E in `packages/app-tests`, Vitest for lib.

Lessons for cohory:

1. Write an `ARCHITECTURE.md` early with the package table, request flow and provider matrix. It doubles as agent context.
2. Copy the provider strategy pattern: a database-backed job queue as the zero-dependency default, BullMQ when Redis is configured. This makes a single-container self-host possible.
3. Gating billing itself as EE works for Documenso because billing is their SaaS plumbing. For cohory, creator payments are core product and must stay open source.
4. A license server with a cached file and graceful fallback is the reference design if we ever sell enterprise self-host licenses.

---

## 4. Formbricks

| Field | Detail |
|-------|--------|
| Repo | https://github.com/formbricks/formbricks |
| License | AGPL 3.0; `apps/web/modules/ee` commercial; SDK packages (`packages/js`, `packages/api` and mobile SDKs) MIT |
| Stars | about 13k |
| Stack | Next.js 16, Prisma 7 on Postgres (pgvector image), Better Auth 1.7, BullMQ + Valkey, i18next, PostHog, SpiceDB (AuthZed) for authorization, pnpm catalogs + Turborepo |
| Layout | `apps/web`, `apps/storybook`; `packages/database`, `packages/jobs`, `packages/cache`, `packages/storage`, `packages/email`, `packages/logger`, `packages/surveys`, `packages/survey-ui`, `packages/js-core`, `packages/types`, `packages/ai`, `packages/workflows`, config packages |

- Modules and domains: `apps/web/modules/<domain>` (auth, billing, survey, organization, workspaces, storage, integrations, mcp, entitlements, and so on) with `apps/web/modules/ee/<feature>` mirroring the shape for enterprise features (sso, teams, role-management, audit-logs, whitelabel, quotas, two-factor-auth, workflows, license-check).
- Auth: Better Auth, with many focused wrappers (`better-auth-hibp`, `better-auth-active-user-gate`, `better-auth-password-reset-gate`, `better-auth-observability`) and integration tests per flow. Legacy `NEXTAUTH_*` names still appear in the codebase, which suggests a migration from NextAuth (unverified).
- Authorization: relationship-based access control with SpiceDB (`authzed/` schema, outbox worker that syncs Postgres changes into SpiceDB). Helpers such as `can(user, "organization.manage", org)`.
- DB and migrations: Prisma schema in `packages/database`, migrations run by a dedicated `formbricks-migrate` container before the app starts.
- Multi-tenancy: row-level organization, workspace (formerly project) and environment hierarchy.
- Payments: Stripe for SaaS billing (`modules/billing`, `modules/ee/billing`); `IS_FORMBRICKS_CLOUD` toggles cloud-only behavior.
- Core vs commercial: `modules/ee` plus `ENTERPRISE_LICENSE_KEY` checked against `https://ee.formbricks.com/api/licenses/check` with distributed locking, cache, and explicit fallback levels (`live`, `cached`, `grace`, `default`).
- Self-hosting: `docker/docker-compose.yml` (postgres, spicedb, valkey, migrate job, app), a `formbricks.sh` installer, Helm `charts/`, smoke tests for release images.
- API and agents: `openapi.yml` at repo root, API v1 and v3, `packages/api-v3-schemas`. A Streamable HTTP MCP endpoint at `apps/web/app/api/mcp/route.ts` built with `mcp-handler`, with OAuth dynamic client registration (`mcp-oauth-dcr.ts`), scope guards (`guard-scopes.ts`), body size limits and PostHog tracing of MCP calls.
- Testing: Vitest unit and integration tests colocated with code, Playwright E2E, SonarCloud.

Lessons for cohory:

1. Formbricks proves Better Auth is production viable in a large Next.js + Postgres app. Wrap it in small, testable policy modules instead of sprinkling config.
2. Put the MCP server inside the web app at `/api/mcp`, authenticate with OAuth 2.1 (dynamic client registration) plus scoped API keys, and enforce scopes per tool.
3. Run migrations as a separate one-shot container in Compose. It avoids race conditions when scaling app replicas.
4. SpiceDB is powerful but adds a second datastore. Cohory should start with in-database role checks behind a single `can()` interface so we can swap later.

---

## 5. Twenty

| Field | Detail |
|-------|--------|
| Repo | https://github.com/twentyhq/twenty |
| License | AGPL 3.0 with a section 7 "Twenty Application Exception"; files marked `/* @license Enterprise */` are commercial (about 560 files by code search); SDK, CLI, UI library and apps under MIT |
| Stars | about 58k |
| Stack | NestJS 11 + GraphQL + REST server, TypeORM (patched) on Postgres, BullMQ + Redis, React front end, Lingui i18n, Nx + Yarn |
| Layout | `packages/twenty-server`, `packages/twenty-front`, `packages/twenty-ui`, `packages/twenty-shared`, `packages/twenty-emails`, `packages/twenty-sdk`, `packages/twenty-client-sdk`, `packages/twenty-cli`, `packages/twenty-apps`, `packages/twenty-docker`, `packages/twenty-docs`, `packages/twenty-e2e-testing`, `packages/twenty-agent-skills`, `packages/twenty-claude-skills` |

- Modules and domains: the server separates `src/engine` (platform: `core-modules`, `metadata-modules`, `twenty-orm`, `workspace-manager`, `api`) from `src/modules` (business objects: company, person, opportunity, calendar, messaging, workflow, task, note). Core modules include billing, feature-flag, enterprise, message-queue, file-storage, i18n, open-api and usage-limit.
- Auth: in-house JWT, API keys, app tokens, SSO and 2FA as core modules; SSO is enterprise (unverified exact split).
- DB and migrations: TypeORM for the core schema plus a custom workspace migration runner that applies metadata-driven DDL per workspace.
- Multi-tenancy: schema per tenant. `getWorkspaceSchemaName(workspaceId)` returns `workspace_<base36 uuid>`. Custom objects and fields are real columns in that schema.
- Payments: Stripe billing for the hosted product (`core-modules/billing`, `billing-webhook`) gated by `IS_BILLING_ENABLED`.
- Core vs commercial: per-file license headers, an enterprise module validating a signed key against an embedded public key (`enterprise-public-key.constant.ts`) with periodic revalidation. The AGPL application exception lets third parties build proprietary apps against the public APIs and SDK.
- Self-hosting: `packages/twenty-docker/docker-compose.yml` runs the same `twentycrm/twenty` image twice (server and worker) plus Postgres 16 and Redis. Helm, k8s, Podman variants, `.env.example` with `STORAGE_TYPE=local` or S3.
- API and agents: GraphQL and REST generated from workspace metadata, OpenAPI per workspace (`core-modules/open-api`), MCP inside the server at `src/engine/api/mcp` with tool annotations (read only, CRUD, execute) and an excluded-tools list. Ships agent skills and Claude skills packages.
- Testing: Jest, Playwright E2E package.

Lessons for cohory:

1. One Docker image, two roles (web and worker) selected by command, is the simplest scalable Compose layout.
2. Generate OpenAPI and MCP tools from the same domain metadata. Annotate tools as read only or destructive so agent clients can ask for confirmation.
3. An AGPL application exception (or MIT SDK packages) removes the main fear developers have about building plugins on an AGPL core.
4. Schema-per-tenant is overkill for cohory. Communities share one schema with row-level `community_id`; Twenty needs per-tenant DDL only because users create custom objects.

---

## 6. Midday

| Field | Detail |
|-------|--------|
| Repo | https://github.com/midday-ai/midday |
| License | AGPL 3.0 (README adds a contradictory "for non-commercial use" note and offers commercial licenses) |
| Stars | about 15k |
| Stack | Next.js 16 dashboard, Hono API with `@hono/zod-openapi` and tRPC 11, Drizzle ORM 0.45 on Supabase Postgres, Supabase auth and storage, Trigger.dev + BullMQ worker, Resend, Bun + Turborepo, Tauri desktop |
| Layout | `apps/api`, `apps/dashboard`, `apps/worker`, `apps/website`, `apps/desktop`; about 35 packages named by domain (`invoice`, `customers`, `banking`, `inbox`, `documents`, `insights`, `notifications`, `jobs`, `job-client`, `db`, `ui`, `email`, `encryption`, `events`, `mcp-apps`, `app-store`, `plans`, `cache`, `logger`) |

- Modules and domains: domain packages are reused by API, worker and dashboard. The API has separate surfaces: `src/rest`, `src/trpc`, `src/mcp`, `src/chat`, `src/bot`.
- Auth: Supabase Auth (JWT), API keys for REST and MCP (unverified exact scheme for MCP).
- DB and migrations: Drizzle schema in one large `packages/db/src/schema.ts` (about 4,200 lines) with `drizzle.config.ts` and about 40 SQL migrations; separate clients for primary, replicas, jobs and worker.
- Multi-tenancy: row-level `teamId` (about 200 references) plus Postgres RLS policies declared in Drizzle with `pgPolicy` (about 110 policies).
- Payments: Polar for the hosted SaaS subscription (README); not a marketplace.
- Core vs commercial: no `ee` split. Everything is AGPL; the business is the hosted product.
- Self-hosting: not a supported path. Only `docker-compose.test.yml` exists, and hosting depends on Supabase, Railway, Vercel and Cloudflare per README.
- API and agents: REST with Zod OpenAPI on Hono, MCP server at `apps/api/src/mcp` with tools per domain (`invoices`, `transactions`, `customers`, `tracker`, `search`, and so on), prompts and resources, plus MCP router tests. `packages/mcp-apps` for MCP UI apps (unverified purpose).
- Testing: Vitest in API, MCP router tests.

Lessons for cohory:

1. Hono + `@hono/zod-openapi` gives typed routes, validation and an OpenAPI document from one definition, and runs inside Next.js route handlers or standalone.
2. Domain packages consumed by API, worker and MCP prevent business logic from leaking into route handlers.
3. Drizzle can declare RLS policies next to tables. Useful as defense in depth for `community_id` isolation, not as the only guard.
4. A single giant schema file does not scale. Split Drizzle schema per module and re-export from `packages/db`.

---

## 7. Ghost

| Field | Detail |
|-------|--------|
| Repo | https://github.com/TryGhost/Ghost |
| License | MIT; owned by the non-profit Ghost Foundation |
| Stars | about 56k |
| Stack | Node.js + Express, Knex + Bookshelf on MySQL 8 (SQLite for dev), knex-migrator, Ember admin being replaced by React apps (`apps/admin`, `admin-x-framework`, `shade` design system), Koenig Lexical editor, Mailgun for newsletters, Tinybird for analytics, pnpm + Nx |
| Layout | `ghost/core` (server, frontend, shared), `apps/*` (admin, portal, comments-ui, signup-form, sodo-search, activitypub, announcement-bar), `koenig/*`, `packages/*` |

- Modules and domains: `ghost/core/core/server/services/<domain>` with about 80 services (members, tiers, offers, stripe, newsletters, email-service, comments, recommendations, gifts, donations, link-tracking, limits, webhooks, themes).
- Auth: staff sessions with 2FA verification; members use passwordless magic links and identity tokens.
- DB and migrations: knex-migrator with versioned migration files; MySQL 8 is the only supported production database (unverified for Ghost 6, historically true).
- Multi-tenancy: none. One site per process. Ghost(Pro) runs the same code with `hostSettings` config and `@tryghost/limit-service` to enforce plan limits.
- Payments: members pay creators through the creator's own Stripe account. The "Connect with Stripe" flow uses a single Ghost Foundation Connect `client_id` and a relay at `https://stripe.ghost.org` that returns the account's keys to any Ghost install, including self-hosted ones (verified in `ghost/core/core/server/services/members/stripe-connect.js`). Ghost advertises 0% transaction fees (https://ghost.org/help/are-there-really-no-transaction-fees). The Stripe service README documents that webhooks arrive out of order and in parallel and lists the handled events (`checkout.session.completed`, `customer.subscription.*`, `invoice.payment_succeeded`).
- Core vs commercial: no code split. Ghost(Pro) differs only by config and hosted services (ActivityPub, analytics).
- Self-hosting: historically Ghost-CLI on Ubuntu + MySQL + Nginx. Ghost 6 introduced an official Docker Compose setup (Caddy, MySQL, optional ActivityPub and analytics via `COMPOSE_PROFILES`) marked "preview" and planned as the default from Ghost 7 (https://docs.ghost.org/install/docker, https://github.com/TryGhost/ghost-docker).
- API and agents: Content API (public, key based) and Admin API (JWT from integration keys), webhooks, an `@tryghost/admin-api-schema` package. No official MCP server found (unverified).
- Testing: Vitest, legacy Mocha (unverified), Playwright `e2e/`, webhook and email mock receivers.

Lessons for cohory:

1. Ghost is the strongest precedent for "your subscribers stay yours": the creator owns the Stripe account, customers and subscriptions, and leaving Ghost leaves everything in Stripe.
2. The relay pattern (one platform `client_id`, a hosted OAuth redirect that hands the result back to any instance) lets self-hosters get a one-click Stripe connection without registering their own Connect platform. Note that it relies on the OAuth `access_token`, which Stripe now marks deprecated. Cohory self-host should prefer restricted API keys pasted by the creator, with an optional relay.
3. Same code for cloud and self-host, differing only by config and a limits service, avoids the open-core tax entirely.
4. Write the webhook handling rules (idempotent, order independent) into the payments package README, as Ghost does.

---

## 8. LearnHouse

| Field | Detail |
|-------|--------|
| Repo | https://github.com/learnhouse/learnhouse (default branch `dev`) |
| License | AGPL 3.0 |
| Stars | about 2.4k |
| Stack | Next.js 16 front end (Tailwind 4, Radix, Lucide, i18next, Resend + React Email, PostHog, Sentry), FastAPI + SQLModel + Alembic back end, Redis, Hocuspocus/Yjs collaboration server, pydantic-ai for AI features |
| Layout | `apps/web`, `apps/api`, `apps/collab`, `apps/cli`, `apps/e2e`; no `packages/` folder |

- Modules and domains: FastAPI `routers/` and `services/` per domain (courses, communities, boards, orgs, roles, usergroups, trail, podcasts, playgrounds, code_execution, webhooks, api_tokens, ai).
- Auth: in-house JWT in FastAPI with MFA router and API tokens (unverified details).
- DB and migrations: Alembic in `apps/api/migrations` with `alembic-postgresql-enum`.
- Multi-tenancy: organizations; running multiple organizations on one instance is an Enterprise feature per README.
- Payments: "Payments (Enterprise): Sell courses with no fees and no lock-in" per README. The web app contains a Stripe Connect OAuth onboarding flow (`apps/web/app/payments/stripe/connect/oauth`) and an offers model, while the API payments service code appears to be absent from the public repo (unverified; Alembic migrations for payments are present).
- Core vs commercial: Enterprise features (payments, SSO, multi-org, audit logs) appear to ship outside the public code, with a `useEnterprisePlan` hook in the web app.
- Self-hosting: an official CLI (`npx learnhouse@latest setup`, `start`, `update`, `backup`, `doctor`, `logs`) that generates config and runs Docker. This is the best self-host UX in this set.
- API and agents: FastAPI auto OpenAPI with a checked-in snapshot (`docs/lib/reference/openapi.snapshot.json`). No MCP found.
- Testing: pytest with coverage (Codecov), CLI tests with Vitest, E2E app, a dedicated Stripe idempotency security test.

Lessons for cohory:

1. A setup CLI (`npx cohory setup`) with `doctor`, `backup` and `update` commands removes most self-host support load. Plan it alongside Docker Compose.
2. A direct competitor already gates payments behind Enterprise. Cohory's differentiator should be open-source payments with a 0% self-host fee.
3. Snapshot the OpenAPI document in the repo and diff it in CI to catch accidental breaking changes.
4. A Python back end plus a Next.js front end doubles the toolchain. Cohory's single TypeScript stack is an advantage for contributors.

---

## 9. Discourse

| Field | Detail |
|-------|--------|
| Repo | https://github.com/discourse/discourse |
| License | GPL 2.0 |
| Stars | about 48k |
| Stack | Ruby on Rails, Ember/Glimmer front end, PostgreSQL, Redis, Sidekiq jobs, pnpm for JS |
| Layout | Rails monolith (`app/`, `lib/`, `db/`, `migrations/`, `frontend/`, `spec/`), bundled plugins in `plugins/` (about 50), themes in `themes/` |

- Modules and domains: the core is a forum engine; optional capabilities are plugins inside the main repo, including `discourse-gamification`, `discourse-subscriptions`, `discourse-events`, `chat`, `discourse-ai`, `automation`, `poll`, `discourse-solved`, `discourse-reactions`, `discourse-patreon`, `discourse-lti`.
- Auth: built-in accounts plus OAuth2, OpenID Connect and provider plugins; DiscourseConnect for SSO with an external site.
- DB and migrations: Rails migrations; plugins ship their own migrations.
- Multi-tenancy: `rails_multisite` (https://github.com/discourse/rails_multisite) serves many sites from one process with a database per site.
- Payments: `discourse-subscriptions` (now bundled in core; the standalone repo is archived) uses the site owner's own Stripe keys (`discourse_subscriptions_public_key`, `discourse_subscriptions_secret_key`, webhook secret) and Stripe pricing tables. No platform fee.
- Gamification: `discourse-gamification` settings define point values per action (like received, like given, solution, invite, time read, post read, topic created) and scorable categories. This is directly comparable to Skool points.
- Core vs commercial: no code split. Revenue comes from hosting; all plugins are open source.
- Self-hosting: the official `discourse_docker` launcher (about 1.9k stars) builds a single all-in-one container; it is the only supported install method (unverified wording).
- API and agents: full REST API used by the Ember client, admin API keys and user API keys. An official MCP stdio client `@discourse/mcp` (https://github.com/discourse/discourse-mcp, MIT) is read only by default with `--allow_writes` opt in.
- Testing: RSpec, system specs, QUnit (unverified current front-end runner). AGENTS.md and AI-AGENTS.md give agent rules.

Lessons for cohory:

1. Ship gamification, events and subscriptions as first-party modules that use the same extension points third-party plugins will use. That forces the plugin API to be real.
2. Copy the gamification design: configurable point values per action, per-category scoping, and a periodic recalculation job.
3. Read-only by default for MCP, with explicit opt-in for writes, is a sensible safety default for community data.
4. GPL 2.0 does not cover network use; that is why Discourse relies on hosting rather than license leverage. Cohory should decide the network clause deliberately.

---

## 10. Payload CMS

| Field | Detail |
|-------|--------|
| Repo | https://github.com/payloadcms/payload |
| License | MIT |
| Stars | about 45k |
| Stack | TypeScript, Next.js-native admin and API, Drizzle-based SQL adapters (`@payloadcms/drizzle` with drizzle-orm 0.45; Postgres, SQLite, D1, Vercel Postgres) and MongoDB, Lexical rich text, pnpm + Turborepo |
| Layout | `packages/payload` (core), `packages/next`, `packages/ui`, `packages/db-*`, `packages/drizzle`, `packages/storage-*` (s3, r2, gcs, azure, vercel-blob), `packages/email-*` (nodemailer, resend), `packages/plugin-*` (mcp, multi-tenant, stripe, ecommerce, search, seo, form-builder, import-export), `packages/sdk`, `templates/`, `examples/`, `test/` |

- Modules and domains: everything is a config of collections and globals; plugins are functions that take a config and return a modified config.
- Auth: built-in auth collections (local strategy, API keys, custom strategies).
- DB and migrations: Drizzle under the hood for SQL; Payload generates migrations from config (`payload migrate:create`) and supports push mode in dev (unverified command names).
- Multi-tenancy: `@payloadcms/plugin-multi-tenant` adds a `tenant` field to selected collections and a tenant selector in the admin panel.
- Payments: `@payloadcms/plugin-stripe` syncs collections with Stripe and handles webhooks; `plugin-ecommerce` for stores.
- Core vs commercial: fully MIT; revenue from Payload Cloud. Payload was acquired by Figma in June 2025 and the maintainers said the repo stays MIT (secondary reports; unverified).
- Self-hosting: it is a Next.js app, so any Node host or container works.
- API and agents: auto REST, GraphQL and a Local API from config. `@payloadcms/plugin-mcp` serves Streamable HTTP at `/api/mcp` with auto CRUD tools per collection filtered by Payload access control, plus `defineTool`, `definePrompt`, `hooks.afterToolCall` and `tools: { delete: false }` style toggles (https://payloadcms.com/docs/plugins/mcp).
- Testing: Vitest, Playwright integration suites in `test/`, type tests with tstyche.

Lessons for cohory:

1. The plugin shape `definePlugin({ name, hooks, ... })` in our notes matches Payload's proven model. Keep plugins as typed, pure config transforms plus lifecycle hooks.
2. Adapter packages per concern (`storage-s3`, `email-resend`) are the clean way to support many vendors without bloating core.
3. Deriving MCP tools from the same access control used by REST guarantees agents never exceed user permissions.
4. Drizzle has been battle tested inside Payload's SQL adapters, which reduces ORM risk for cohory.

---

## Summary matrix

| Project | License | ORM / DB | Auth | Jobs | API style | MCP | Self-host |
|---------|---------|----------|------|------|-----------|-----|-----------|
| Cal.diy | MIT (commercial Cal.com closed) | Prisma + Kysely / Postgres | NextAuth v4 | Trigger.dev, Tasker (unverified) | tRPC, NestJS REST v2 + Swagger | Hosted, OAuth 2.1 | Compose, but "non-production" |
| Dub | AGPL + `(ee)` | Prisma / MySQL (PlanetScale) | NextAuth v4 + Jackson | QStash | Next route handlers + Zod OpenAPI | Hosted | Needs 5 SaaS vendors |
| Documenso | AGPL + `packages/ee` | Prisma + Kysely / Postgres | Custom (Arctic, passkeys) | Local DB queue, BullMQ, Inngest | tRPC as OpenAPI, ts-rest v1 | Not found | Compose, Railway, Render |
| Formbricks | AGPL + `modules/ee`, MIT SDKs | Prisma 7 / Postgres | Better Auth | BullMQ | REST v1/v3 + `openapi.yml` | In app, OAuth DCR | Compose, Helm |
| Twenty | AGPL + exception + `@license Enterprise` files | TypeORM / Postgres (schema per tenant) | Custom JWT | BullMQ | GraphQL + REST + OpenAPI | In server | Compose (server + worker), Helm |
| Midday | AGPL | Drizzle / Supabase Postgres + RLS | Supabase Auth | Trigger.dev + BullMQ | Hono Zod OpenAPI + tRPC | In API | Not supported |
| Ghost | MIT | Knex + Bookshelf / MySQL | Custom, magic links | Internal jobs service | Content + Admin REST | Not found | Ghost-CLI, Compose preview |
| LearnHouse | AGPL (payments Enterprise) | SQLModel + Alembic / Postgres | Custom JWT | Redis (unverified usage) | FastAPI OpenAPI | Not found | CLI wizard + Docker |
| Discourse | GPL 2.0 | ActiveRecord / Postgres | Built-in + OAuth plugins | Sidekiq | REST | Official stdio client | Docker launcher |
| Payload | MIT | Drizzle (SQL) or Mongo | Built-in collections | Jobs queue (unverified) | REST, GraphQL, Local API | Official plugin | Any Node host |

---

## Synthesis

### (a) Recurring stack patterns

| Concern | Most common choice in this set | Alternatives seen | Notes for cohory |
|---------|-------------------------------|-------------------|------------------|
| Language and framework | TypeScript + Next.js (Cal, Dub, Formbricks, Midday, LearnHouse web, Payload) | Remix on Hono (Documenso), NestJS (Twenty, Cal API v2), Rails (Discourse), Express (Ghost), FastAPI (LearnHouse) | Next.js matches; consider a Hono API mounted in Next.js route handlers |
| Monorepo | Turborepo (Cal, Dub, Documenso, Formbricks, Midday, Payload) | Nx (Twenty, Ghost) | pnpm + Turborepo is mainstream; pnpm catalogs (Formbricks) keep versions aligned |
| ORM | Prisma (Cal, Dub, Documenso, Formbricks, Papermark) | Drizzle (Midday, Payload), TypeORM (Twenty), Knex (Ghost), Kysely as a side car (Cal, Documenso) | Prisma is still the majority. Drizzle is rising and is what we prefer; teams on Prisma often add Kysely for raw SQL, which Drizzle already covers |
| Database | PostgreSQL (8 of 10) | MySQL (Dub, Ghost) | Postgres only; do not support MySQL |
| Auth | Custom or framework built in (Documenso, Twenty, Ghost, Discourse, Payload, LearnHouse) | NextAuth v4 (Cal, Dub, Papermark), Better Auth (Formbricks), Supabase Auth (Midday) | NextAuth v4 is legacy; Better Auth is the modern option with a production reference |
| Authorization | Role checks in code | SpiceDB (Formbricks), Postgres RLS (Midday) | One `can()` helper with roles; RLS later as defense in depth |
| Job queue | BullMQ + Redis (Twenty, Formbricks, Midday, Documenso optional) | Trigger.dev (Cal, Midday, Papermark), Inngest (Documenso), QStash (Dub), Sidekiq (Discourse) | BullMQ is the self-host friendly default; hosted queues hurt self-hosting |
| Email | React Email templates + Nodemailer SMTP or Resend | Mailgun (Ghost newsletters), MailChannels | Provider switch by env var (Documenso pattern) |
| Storage | S3-compatible via `@aws-sdk/client-s3` | Local disk default (Twenty `STORAGE_TYPE=local`), DB storage (Documenso) | Local disk default plus S3/MinIO/R2 adapter |
| Feature flags | DB-backed flags module (Cal `features/flags`, Twenty `feature-flag`) plus plan capabilities (Dub) | PostHog flags | Own `flags` table per community and global; no external flag service required |
| Entitlements and limits | Plan capability maps (Dub `plan-capabilities.ts`), limit services (Ghost), entitlements module (Formbricks) | License claims (Documenso) | Needed for cloud plans only; keep it in core and inert when self-hosted |
| i18n | i18next family (Cal, Formbricks, LearnHouse, Papermark) | Lingui (Documenso, Twenty), Payload own package | Lingui has good extraction and is used by two serious TS apps; next-intl is another option (not seen here) |
| Analytics | PostHog (Cal, Documenso, Formbricks, LearnHouse, Papermark, Trigger.dev) | Tinybird (Dub, Ghost), OpenPanel (Midday) | Telemetry must be opt-in and off by default when self-hosted |
| Errors | Sentry (Cal, Formbricks, Twenty, Midday, LearnHouse) | | Optional DSN env var |
| UI | Tailwind + Radix + shadcn/ui + Lucide (Documenso, Formbricks, LearnHouse, Dub, Papermark) | Custom design systems (Ghost `shade`, Twenty `twenty-ui`) | Matches our plan |
| Testing | Vitest + Playwright (Cal, Dub, Documenso, Formbricks, Payload) | Jest (Twenty, Cal API), pytest, RSpec | Vitest + Playwright, plus API contract tests |
| Agent docs | `AGENTS.md` and/or `CLAUDE.md` in nearly every repo (Cal, Documenso, Formbricks, Twenty, Ghost, Discourse, Payload, Trigger.dev) | Skills folders (Twenty, Discourse `.skills`) | Add `AGENTS.md` and `ARCHITECTURE.md` from the first commit |

### (b) Core vs cloud split and license choice

Observed models:

| Model | Examples | How it works | Observed trade-offs |
|-------|----------|--------------|---------------------|
| Fully permissive, revenue from hosting | Ghost (MIT), Payload (MIT), Cal.diy (MIT) | Same code everywhere; cloud differs by config | Maximum adoption and contributor trust; competitors can host it; Ghost survives this as a non-profit with a strong brand |
| Copyleft, revenue from hosting | Discourse (GPL 2.0), Midday (AGPL) | No code split | GPL 2.0 has no network clause, so it does not deter hosted forks; Midday's "non-commercial" wording conflicts with AGPL itself |
| AGPL core + commercial `ee` folder | Dub `(ee)`, Documenso `packages/ee`, Formbricks `modules/ee`, Papermark `ee/` | Folder-level license, optionally a license key | Clear boundary, but contributors must know which folder they touch; CLAs are common (Documenso, Papermark) |
| AGPL core + per-file enterprise headers | Twenty (`/* @license Enterprise */`) | File-level license plus signed key | Fine grained but harder to audit |
| AGPL core + MIT SDK + application exception | Twenty, Formbricks (MIT SDKs) | Clients and plugins are permissive | Removes AGPL fear for plugin and integration authors |
| Open core then closed | Cal.com (April 2026) | Production repo made private; MIT community fork published without EE | Loss of trust and of the "open source" marketing claim; stated reason was security exposure of public code to AI-driven scanning |
| Fair source | Sentry and others under FSL (https://fsl.software) | Source available, non-compete for two years, then converts to Apache 2.0 or MIT | Not OSI open source; would contradict cohory's "open-source alternative" positioning |

Runtime enforcement patterns:

- License key + license server + cached file + grace period: Documenso (`license.documenso.com`), Formbricks (`ee.formbricks.com`, fallback levels live, cached, grace, default).
- Signed offline key validated with an embedded public key: Twenty.
- Cloud toggles by env var: `IS_BILLING_ENABLED` (Documenso, Twenty), `IS_FORMBRICKS_CLOUD` (Formbricks), `hostSettings` + limit service (Ghost).

Implication for cohory: our business model is a 2% fee on cloud transactions, not feature gating. The fee is enforced by where the code runs (our Stripe Connect platform), not by code ownership. Self-hosters cannot use our Connect platform without our cooperation, so there is no need for an `ee` folder to protect revenue.

### (c) Stripe Connect patterns for creator-owned subscriptions

All facts below were verified on docs.stripe.com on 2026-10-17.

| Topic | What Stripe documents | Source |
|-------|----------------------|--------|
| Charge type | Direct charges create the charge on the connected account, which is the merchant of record; refunds and chargebacks debit the connected account. "Direct charges are recommended for connected accounts with access to the full Stripe Dashboard, which includes Standard accounts." | https://docs.stripe.com/connect/subscriptions |
| Subscriptions on the creator account | Create the subscription while authenticated as the connected account (`Stripe-Account` header); Price and Customer must live on the connected account; use `payment_behavior: "default_incomplete"` without a default payment method | https://docs.stripe.com/connect/subscriptions |
| Platform fee | `application_fee_percent` on the subscription, a decimal from 0 to 100 with at most two decimals. It is applied once per billing period to the final invoice amount, and it does not apply to proration invoices created outside the billing cycle; for those, set `application_fee_amount` on the invoice | https://docs.stripe.com/connect/subscriptions |
| One-time purchases (courses) | Checkout Session with `Stripe-Account` header and `payment_intent_data[application_fee_amount]`; no additional Stripe fee on the application fee; Brazilian connected accounts cannot pay application fees to non-Brazilian platforms | https://docs.stripe.com/connect/direct-charges |
| Refunds | Application fees are not refunded automatically; pass `refund_application_fee=true` | https://docs.stripe.com/connect/direct-charges |
| Fee events | `application_fee.created` is emitted asynchronously | https://docs.stripe.com/connect/direct-charges |
| Restrictions | "Your platform can't update or cancel a subscription that another platform created." A platform cannot add `application_fee_amount` to invoices it did not create | https://docs.stripe.com/connect/subscriptions |
| Disconnection | Subscriptions are not canceled on disconnect. For direct charges, subscriptions keep running on the creator's account and the platform keeps collecting `application_fee_percent` unless it is removed; after disconnect the creator can clear it through the API | https://docs.stripe.com/connect/subscriptions |
| Disconnect event | `account.application.deauthorized` fires when a connected account disconnects; platforms can revoke with `POST https://connect.stripe.com/oauth/deauthorize` (Standard accounts only) | https://docs.stripe.com/connect/oauth-reference |
| OAuth status | "OAuth isn't recommended for new Connect platforms." Stripe recommends Connect Onboarding for Standard accounts instead. OAuth `access_token`, `refresh_token` and `stripe_publishable_key` are deprecated in favor of the `Stripe-Account` header. Platforms using OAuth cannot connect accounts controlled by another platform | https://docs.stripe.com/connect/oauth-standard-accounts, https://docs.stripe.com/connect/oauth-reference |
| Data visibility | Data the platform creates on a Standard account is visible to the account owner and to any other platform they connect | https://docs.stripe.com/connect/oauth-reference |
| Subscription import | Billing migration toolkit or API scripts; between Stripe accounts, first copy customer and payment method data (PAN copy), then migrate subscriptions | https://docs.stripe.com/billing/subscriptions/migrate-subscriptions, https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit, https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve |
| Useful events | `invoice.paid` to grant access, `invoice.payment_failed`, `customer.subscription.updated` and `.deleted`, `account.updated`, `entitlements.active_entitlement_summary.updated` | https://docs.stripe.com/connect/subscriptions |

How this maps to the founder notes:

1. "Subscription Ownership: your subscribers stay yours" is native to direct charges on a Standard (full Dashboard) account. Customers, payment methods, prices and subscriptions all live in the creator's account. Ghost and Cal.com both use this model.
2. "Bring your existing subscribers", Option A (connect an existing Stripe account): if the existing subscriptions were created by the creator directly (Dashboard, Payment Links, their own code), cohory can link them by reading them with the `Stripe-Account` header and mapping customers to members. If they were created by another platform (for example a competitor that used Connect), cohory cannot update or cancel them. The safe flow is to create a new cohory subscription on the same account using the saved payment method (no PAN copy needed, since the payment method is already on that account), aligned to the old period end with `trial_end` or a billing cycle anchor, and have the creator cancel the old one in their Dashboard. Each step needs confirmation; this flow is a design proposal, not a documented Stripe recipe.
3. Option B (move between Stripe accounts): requires Stripe's PAN copy between accounts, then subscription import. This is a Stripe-mediated process, not something cohory can automate fully.
4. Option C (Skool, no payment-method access): members must re-enter payment details. Offer a re-subscribe campaign with a discount or `trial_end` until their Skool period ends.
5. Disconnect: when a creator leaves cohory cloud, we must remove `application_fee_percent` from their subscriptions before or right after disconnection. Doing it automatically is both an ethical commitment and the only way to keep the "your subscribers stay yours" promise honest.
6. Onboarding: use Connect Onboarding (Account Links) for new Standard-style accounts with full Dashboard access, and support linking existing accounts. Treat OAuth as a legacy path (Ghost and Cal.com still use it).
7. Fee ledger: record every `application_fee.created` (and refunds) in our own ledger table keyed by community, for the BYO provider monthly invoicing path in the notes.

### (d) Agent and MCP exposure precedents

| Project | Where | Transport and auth | Tool design |
|---------|-------|--------------------|-------------|
| Cal.com | Hosted `mcp.cal.com/mcp` | Streamable HTTP, OAuth 2.1 | Wraps API v2 (bookings, event types, schedules) |
| Dub | Hosted `mcp.dub.sh` (partners, links) | HTTP, API key, clients via `mcp-remote` | Product-scoped servers |
| Formbricks | In app `/api/mcp` | Streamable HTTP via `mcp-handler`, OAuth dynamic client registration, scope guards, body size limits | Domain tools with output schemas, PostHog tracing |
| Twenty | In server `engine/api/mcp` | HTTP, workspace API keys (unverified) | Tool annotations (read only, CRUD, execute), excluded tools list |
| Midday | In API `src/mcp` | HTTP (unverified auth) | Tools per domain plus prompts and resources, router tests |
| Payload | Plugin, `/api/mcp` | Streamable HTTP, Payload auth | Auto CRUD per collection filtered by access control, `defineTool`, toggles like `delete: false`, `afterToolCall` hook |
| Discourse | Separate npm package `@discourse/mcp` | stdio client using site API keys | Read only by default, `--allow_writes` opt in, selectable toolsets |

Patterns:

- MCP lives next to the REST API and reuses its auth and domain services; nobody builds a separate MCP backend.
- OAuth 2.1 with dynamic client registration is becoming the norm for hosted servers (Cal.com, Formbricks), with API keys as the fallback.
- Safety: read-only defaults, explicit write opt-in, tool annotations for destructive operations, per-tool scope checks.
- Agent-facing repo docs (`AGENTS.md`, skills folders) are now standard; Twenty and Discourse ship skills for agents.
- No project in this set offers agent entitlements to paid content (our "agents access paid courses" idea). That is a genuine differentiator, and it needs delegated, scoped, revocable tokens tied to a human's entitlement.

### (e) Recommendations for cohory

Architecture:

- **Recommendation:** Keep a modular monolith: one Next.js app (`apps/web`) plus one worker process built from the same Docker image. Rationale: Twenty and Formbricks show one image with two roles is the simplest thing that scales.
- **Recommendation:** Put business logic in domain packages (`packages/community`, `packages/courses`, `packages/events`, `packages/members`, `packages/gamification`, `packages/payments`, `packages/migration`) that export services consumed by UI, REST, MCP and jobs. Rationale: Midday and Documenso keep route handlers thin this way.
- **Recommendation:** Build the public REST API with Hono + `@hono/zod-openapi` mounted under `/api/v1` in Next.js, and serve `/api/openapi.json`. Rationale: one Zod definition yields validation, types and OpenAPI (Midday, Dub).
- **Recommendation:** Generate MCP tools from the same service layer and expose them at `/mcp` with Streamable HTTP, OAuth 2.1 plus scoped API keys, read-only default scopes and tool annotations. Rationale: Formbricks, Payload and Twenty precedent, and safety for community data.
- **Recommendation:** Use Drizzle with schema files per module, re-exported from `packages/database`, and checked-in SQL migrations run by a one-shot `migrate` service in Compose. Rationale: avoids Midday's 4,000-line schema file and Formbricks shows the migrate container pattern.
- **Recommendation:** Row-level tenancy with `community_id` on every community-scoped table, enforced in a repository layer, with Postgres RLS as optional defense in depth. Rationale: schema-per-tenant (Twenty) is unnecessary without user-defined schemas.
- **Recommendation:** Use Better Auth for identity and keep authorization in a single `can(actor, action, resource)` helper. Rationale: Formbricks runs Better Auth in production; NextAuth v4 is legacy.
- **Recommendation:** Provider strategy by env var for jobs (Postgres-backed default, BullMQ when `REDIS_URL` is set), storage (local disk default, S3-compatible), email (SMTP default, Resend optional). Rationale: Documenso shows this enables a minimal self-host and a scalable cloud from the same code.
- **Recommendation:** Treat payments as a provider interface (`stripe-connect`, `stripe-byo-keys`, later others) with a fee ledger and idempotent, order-independent webhook handlers. Rationale: Ghost's webhook rules and Dub's Connect handlers.
- **Recommendation:** Use direct charges on creator-owned accounts with full Dashboard access (now configured through Accounts v2 as defined in [../architecture/payments.md](../architecture/payments.md); the legacy Standard type is deprecated for new platforms) with `application_fee_percent=1` for subscriptions and `application_fee_amount` for one-time sales. Rationale: this is the Stripe-documented model for creator ownership.
- **Recommendation:** On disconnect or downgrade to self-host, automatically clear `application_fee_percent` on the creator's subscriptions and listen for `account.application.deauthorized`. Rationale: Stripe keeps collecting the fee otherwise, which would break the ownership promise.
- **Recommendation:** For self-hosted installs, support pasting the creator's own restricted Stripe key (0% fee, no Connect) as the default, with an optional hosted relay later. Rationale: Ghost's relay depends on deprecated OAuth tokens; Discourse shows BYO keys work.
- **Recommendation:** Ship gamification, events and subscriptions as first-party modules built on the same hook API that `@cohory/sdk` exposes (`definePlugin({ hooks })`). Rationale: Discourse and Payload prove the extension API only stays real when first-party features use it.
- **Recommendation:** Keep feature flags and plan limits in our own database tables, inert on self-host. Rationale: Cal.com, Twenty and Ghost avoid external flag services.
- **Recommendation:** Telemetry (PostHog or similar) opt-in and disabled by default on self-host. Rationale: trust for self-hosters.

Repository layout:

- **Recommendation:** Adopt this layout (refining the one in the notes). Rationale: it matches the most common Turborepo shape in this set and separates domains from delivery surfaces.

```
cohory/
  apps/
    web/            # Next.js: UI, /api/v1 (Hono), /mcp, auth routes
    worker/         # entry that runs jobs from packages (same image, different command)
    docs/           # documentation site, renders /docs and /docs/api from openapi.json
  packages/
    database/       # Drizzle client, per-module schema re-exports, migrations
    auth/           # Better Auth config, can() authorization helper
    api/            # Hono app, OpenAPI registry, API key auth
    mcp/            # MCP server, tool definitions generated from services
    jobs/           # queue abstraction (postgres | bullmq) and job registry
    storage/        # local | s3 adapters
    email/          # React Email templates, smtp | resend adapters
    community/      # posts, comments, likes, categories
    courses/        # courses, modules, lessons, progress
    events/         # calendar, events, RSVPs
    members/        # memberships, roles, profiles, invitations
    gamification/   # points rules, levels, leaderboards
    payments/       # provider interface, stripe-connect, byo, fee ledger, webhooks
    migration/      # Skool, Circle, CSV importers and normalization
    sdk/            # @cohory/sdk, definePlugin, typed API client (MIT)
    ui/             # shadcn/ui based components
    config/         # tsconfig, eslint or biome, tailwind presets
  docker/
    compose.yml     # app, worker, migrate, postgres, redis, minio (optional)
  AGENTS.md
  ARCHITECTURE.md
  LICENSE
```

- **Recommendation:** Add `AGENTS.md` and `ARCHITECTURE.md` in the first commit, with the package table and request flow. Rationale: Documenso and most of this set do it, and it is our agent-first positioning.
- **Recommendation:** Plan a `npx cohory setup` CLI with `doctor`, `backup` and `update` after Compose works. Rationale: LearnHouse shows this is the best self-host UX.
- **Recommendation:** Snapshot `openapi.json` in the repo and fail CI on unreviewed diffs. Rationale: LearnHouse snapshot pattern; protects agent and SDK consumers.

Licensing:

- **Recommendation** (input to ADR 0009, accepted by the founder on 2026-10-19): License the core under AGPL 3.0 with no `ee` folder, and license `packages/sdk`, the API client and plugin templates under MIT; add an explicit plugin exception modeled on Twenty's section 7 exception. Rationale: AGPL stops a competitor from running a closed hosted fork, our revenue comes from the Connect fee rather than gated features, and MIT SDKs remove AGPL fear for plugin authors.
- **Recommendation:** Do not adopt a fair-source license such as FSL. Rationale: it is not OSI open source and would undercut the "open-source Skool alternative" claim that drives GitHub adoption.
- **Recommendation:** Use a DCO (Signed-off-by) rather than a CLA unless relicensing is a real plan. Rationale: CLAs (Documenso, Papermark) reduce casual contributions; a DCO keeps provenance without assignment. If we want the option to relicense later, a CLA is the price, and that should be decided up front.
- **Recommendation:** If the founders strongly prefer maximum adoption over protection, MIT is the credible alternative, following Ghost and Payload. Rationale: both thrive on MIT because hosting, brand and payments integration are the moat, which also applies to us.

### (f) Risks and anti-patterns observed

| Risk or anti-pattern | Where observed | Mitigation for cohory |
|----------------------|---------------|------------------------|
| Closing source after building on open source | Cal.com moved production code private in April 2026 | No `ee` surface to grow; public commitment to keep the core open; AGPL rather than a license we would later need to tighten |
| "Community edition not for production" | Cal.diy README | Self-host must be the same code as cloud, production grade, with upgrade docs |
| Self-hosting that requires many SaaS vendors | Dub (Vercel, PlanetScale, Upstash, Tinybird, Cloudflare), Midday (Supabase, Railway, Trigger.dev) | Every dependency has a local default; CI runs the Compose stack end to end |
| Hosted job runners as hard dependencies | Trigger.dev, Inngest, QStash usage | Queue abstraction with a Postgres-backed default and BullMQ |
| License wording that contradicts the license | Midday README says AGPL "for non-commercial use" | Keep LICENSE and README consistent; have the license choice reviewed |
| Folder or file level license splits that confuse contributors | Dub `(ee)`, Twenty per-file headers | No commercial code in the public repo |
| Gating payments behind enterprise | LearnHouse payments, Documenso Stripe billing module | Payments stay open source; only our Connect platform fee is commercial |
| Relying on deprecated Stripe OAuth tokens | Ghost relay returns `access_token` and publishable key | Use Account Links and the `Stripe-Account` header; BYO restricted keys for self-host |
| Platform fee surviving disconnection | Stripe keeps collecting `application_fee_percent` after disconnect for direct charges | Automatic fee removal job on disconnect and on plan change |
| Subscriptions created by another platform cannot be modified | Stripe Connect restriction | Migration Center recreates subscriptions on the same account instead of adopting foreign ones; clear UX copy |
| Out-of-order and parallel webhooks | Documented in Ghost Stripe service README | Idempotency keys, event table with unique `event.id`, state derived from Stripe objects rather than event order |
| Giant single schema file | Midday `schema.ts` about 4,200 lines | Schema per module |
| Second datastore for authorization too early | Formbricks SpiceDB | Start with in-database roles behind `can()` |
| Single database engine lock to MySQL | Ghost, Dub | Postgres only, documented |
| Monolithic plugin repos that only core can extend | Discourse plugins historically required Ruby and core knowledge | Typed `@cohory/sdk` with versioned hooks and a compatibility policy |
| MCP with write access by default | Not observed in official servers, which all default to restricted access | Read-only default scopes, explicit write scopes, destructive tool annotations, audit log of agent actions |

---

## Appendix A: License options compared for cohory

| Criterion | MIT or Apache 2.0 | AGPL 3.0 core + MIT SDK | AGPL + `ee` folder | FSL (fair source) |
|-----------|-------------------|-------------------------|--------------------|-------------------|
| OSI open source | Yes | Yes | Core yes, `ee` no | No (until conversion after two years) |
| Blocks closed hosted forks | No | Yes (network clause) | Yes | Yes |
| Plugin authors can stay proprietary | Yes | Yes, with MIT SDK and an explicit exception | Depends | Depends on terms |
| Enterprise adoption friction | Lowest | Some legal review for AGPL | Some, plus license keys | Highest, non-standard |
| Fits "open-source Skool alternative" claim | Yes | Yes | Partly | No |
| Examples in this research | Ghost, Payload, Cal.diy, Trigger.dev (Apache) | Twenty (with exception), Formbricks (MIT SDKs) | Dub, Documenso, Formbricks, Papermark | Sentry and others (https://fsl.software) |
| Fit with a transaction-fee business | Good, the fee is tied to our Connect platform | Good | Unnecessary complexity | Poor |

## Appendix B: Stripe webhook events cohory should handle at launch

| Event | Account context | Cohory action |
|-------|-----------------|---------------|
| `checkout.session.completed` | Connected account | Create pending membership or course entitlement; wait for payment confirmation when async |
| `invoice.paid` | Connected account | Grant or extend membership access |
| `invoice.payment_failed` | Connected account | Notify member and creator; start grace period |
| `customer.subscription.updated` | Connected account | Sync status, price, period end, cancel at period end |
| `customer.subscription.deleted` | Connected account | Revoke access at period end |
| `charge.refunded` | Connected account | Adjust fee ledger; confirm `refund_application_fee` was applied |
| `application_fee.created` | Platform | Write fee ledger entry per community |
| `account.updated` | Platform (Connect) | Track `charges_enabled`, `payouts_enabled`, requirements; show plain-language status in Manage, Payments |
| `account.application.deauthorized` | Platform (Connect) | Mark community payments as disconnected; schedule fee removal on subscriptions; switch community to read-only billing state |

Implementation rules (from Ghost's Stripe README and Stripe docs): store every event id with a unique constraint, process idempotently, fetch the current Stripe object rather than trusting event order, and run handlers in the worker rather than in the HTTP request.

## Appendix C: Migration Center mapping to Stripe capabilities

| Source situation | Stripe capability | What cohory can automate | What needs the creator or Stripe |
|------------------|-------------------|--------------------------|----------------------------------|
| Creator already sells with their own Stripe account (Payment Links, Dashboard, own code) | Connect the existing account; read subscriptions with the `Stripe-Account` header | Match Stripe customers to imported members by email; link subscriptions to memberships | Confirm mapping of prices to cohory tiers |
| Subscriptions on the creator's account created by another Connect platform | Cannot be updated or cancelled by cohory | Recreate subscriptions on the same account with saved payment methods, aligned to the current period end | Creator cancels the old subscriptions or the other platform does |
| Subscriptions in a different Stripe account | PAN copy between accounts, then Billing migration toolkit | Import members and content; prepare a price mapping file | Request the copy through Stripe; run the toolkit |
| Platform without payment-method export (Skool) | None | Import members, posts, courses where exportable; send re-subscribe invitations with trial until old renewal date | Members re-enter payment details |
| Generic CSV or API source | Billing migration toolkit if payment data reaches Stripe | Normalization pipeline into members, courses, posts | Depends on source |

## Appendix D: Open questions raised by this research

1. Connected account configuration: Standard accounts via Connect Onboarding, or Accounts v2 with full Dashboard access configured through controller properties. Both support direct charges; the choice affects who pays Stripe fees and who handles negative balances. Needs a decision with Stripe's current Accounts v2 guidance.
2. Tax: with direct charges the creator is merchant of record. Do we enable Stripe Tax on connected accounts by default, or leave it to the creator?
3. Merchant of record for "Cloud, Managed Payments" versus "Cloud, BYOP": the BYOP monthly invoicing path needs a reliable revenue report from a provider we do not control. How do we verify it?
4. Agent entitlements to paid courses: token format, scope, expiry and revocation for delegated agent access. No precedent exists in this set.
5. Plugin execution model: in-process trusted plugins (Payload, Discourse) versus sandboxed plugins for a future marketplace. The first is simpler and is what all comparable projects do.
6. Relicensing optionality: if we want to keep the right to dual license later, a CLA is required now. Decide before accepting outside contributions.

---

## Sources

Repositories and files (read via `gh api` on 2026-10-17):

- https://github.com/calcom/cal.diy (README, LICENSE, `packages/app-store/stripepayment`, `apps/api/v2`)
- https://github.com/dubinc/dub (LICENSE.md, `apps/web/app/(ee)/README.md`, `apps/web/docker-compose.yml`, `apps/web/prisma/schema`)
- https://github.com/documenso/documenso (ARCHITECTURE.md, `packages/ee/FEATURES`, `packages/lib/server-only/license/license-client.ts`, `.env.example`)
- https://github.com/formbricks/formbricks (LICENSE, `apps/web/modules`, `apps/web/app/api/mcp/route.ts`, `authzed/README.md`, `docker/docker-compose.yml`, `apps/web/modules/ee/license-check/lib/license.ts`)
- https://github.com/twentyhq/twenty (LICENSE, `packages/twenty-server/src`, `packages/twenty-docker`, `get-workspace-schema-name.util.ts`)
- https://github.com/midday-ai/midday (README, `packages/db/src/schema.ts`, `apps/api/src/mcp`)
- https://github.com/TryGhost/Ghost (`ghost/core/core/server/services/stripe/README.md`, `ghost/core/core/server/services/members/stripe-connect.js`, `ghost/package.json`)
- https://github.com/learnhouse/learnhouse (README, `apps/api/pyproject.toml`, `apps/web/services/payments/providers/stripe.ts`)
- https://github.com/discourse/discourse (`plugins/discourse-subscriptions/config/settings.yml`, `plugins/discourse-gamification/config/settings.yml`, AI-AGENTS.md)
- https://github.com/discourse/discourse-mcp, https://github.com/discourse/rails_multisite, https://github.com/discourse/discourse_docker
- https://github.com/payloadcms/payload (`docs/plugins/mcp.mdx`, `docs/plugins/multi-tenant.mdx`, `packages/drizzle/package.json`)
- https://github.com/papermark/papermark (LICENSE), https://github.com/triggerdotdev/trigger.dev (metadata)

Documentation and articles:

- https://cal.com/blog/cal-diy-open-source-to-closed-source
- https://cal.com/docs/mcp-server
- https://dub.co/docs/self-hosting
- https://dub.co/docs/mcp-server
- https://ghost.org/help/are-there-really-no-transaction-fees
- https://ghost.org/integrations/stripe/
- https://docs.ghost.org/install/docker
- https://github.com/TryGhost/ghost-docker
- https://payloadcms.com/docs/plugins/mcp
- https://fsl.software/
- https://www.cmswire.com/digital-experience/when-cms-meets-ux-design-what-figmas-payload-deal-really-means (Figma acquisition coverage, secondary)

Stripe documentation (fetched 2026-10-17):

- https://docs.stripe.com/connect/subscriptions
- https://docs.stripe.com/connect/direct-charges
- https://docs.stripe.com/connect/oauth-reference
- https://docs.stripe.com/connect/oauth-standard-accounts
- https://docs.stripe.com/billing/subscriptions/migrate-subscriptions
- https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit
- https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve
