# Threat model

What Cohory protects, who can attack it, where trust changes hands, and which controls exist today with the file that implements each one.

This document was written at MVP 0.1.0 and is updated as surfaces are added; a row that depends on a later release names it. Controls listed here exist in the repository today. Planned controls are marked as such and are not available. The companion review with findings is [review-2026-10](review-2026-10.md). Reporting rules are in [SECURITY.md](../../SECURITY.md).

## 1. Assets

| Asset | Why it matters | Where it lives |
|-------|----------------|----------------|
| Member identities and sessions | Account takeover gives access to every community the person belongs to | `users`, `sessions`, `accounts`, `verifications` (Better Auth tables, no RLS) |
| Community content | Posts, comments, lessons, events, and attachments are the product; paid content is gated | Tenant tables with `community_id` and forced RLS, uploads under `communities/<id>/` |
| Membership and roles | Roles decide who can manage people, money, and settings | `memberships` |
| Payment credentials | Creators' Stripe secret keys and webhook secrets on the Community Edition, the platform key on Cloud | `payment_connections` (AES-256-GCM at rest), environment |
| Money state | Plans, subscriptions, customers, and the fee ledger drive access and payouts | `membership_plans`, `subscriptions`, `payment_customers`, `payments`, `fee_ledger_entries` |
| Audit log and outbox | Prove who did what and deliver cross module effects exactly once | `audit_log`, `outbox`, `provider_events` |
| Server secrets | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `PAYMENTS_ENCRYPTION_KEY`, SMTP and S3 credentials | Environment only, never in the client bundle |
| Availability | A self-hosted instance has one web process and one worker | Compose stack |

## 2. Actors

| Actor | Trust | Capabilities today |
|-------|-------|--------------------|
| Guest | None | Read public communities, sign up, sign in, redeem an invite preview |
| Member | Signed in, active membership | Read entitled content, post, comment, like, RSVP, update own profile, buy a membership |
| Moderator | Staff | Member actions plus remove or ban members, delete posts and comments, move posts |
| Admin | Staff | Moderator actions plus content management, settings, appearance, invites, roles up to moderator, payments reads |
| Owner | Full control of one community | Everything in the community, including ownership transfer, archive, delete, export, payment connection, plan editing, refunds |
| Platform operator | Runs the server | Database, environment, logs, Stripe dashboard. Out of scope for in-app controls, in scope for hardening guidance |
| Agent | Scoped actor acting for one person in one community | Built since 0.6.0 (API tokens) and 0.7.0 (MCP with OAuth). Reads within its scopes; writes on money, roles, removals, deletion, publishing, settings, and exports become approval requests; can never archive, delete, or transfer the community. Rules in [authorization](../architecture/authorization.md) sections 6 to 8, threats in [agent-integrations](../architecture/agent-integrations.md) section 9, course material in [review-agent-courses](review-agent-courses.md) |
| Stripe | Trusted after signature verification | Sends webhooks, hosts Checkout and the billing portal |

Roles are defined in `packages/authz/src/matrix.ts` and `packages/authz/src/types.ts`. The matrix is the only place that grants an action.

## 3. Trust boundaries

```
browser --(HTTPS via reverse proxy)--> Next.js server (pages, server actions, /api/auth, /api/uploads)
                                     \--> Hono API (/api/v1) --> domain services --> Postgres (RLS, app role)
Stripe --(signed webhooks)--> /api/webhooks/stripe --> provider_events row + pg-boss job --> worker --> payments service --> Postgres
worker --(pg-boss, outbox)--> jobs --> domain services --> Postgres, SMTP
Next.js server --> object storage (local disk or S3) --> served back through /api/uploads
Next.js server --> SMTP
agent or assistant --(bearer token or OAuth access token)--> /api/v1 and /mcp --> approval queue for sensitive writes --> domain services --> Postgres
worker --(signed outbound webhooks through the egress helper)--> third party receivers
```

| Boundary | What crosses it | Validation on entry |
|----------|-----------------|---------------------|
| Browser to Next server | Cookies, form posts, server action arguments, query strings | Zod per action (`apps/web/lib/*/schemas.ts`, `packages/auth/src/forms.ts`), `safeRedirectPath` for `next=` |
| Browser to API | JSON bodies, params, query | `@hono/zod-openapi` schemas per route (`packages/api/src/routes/*-schemas.ts`) |
| Browser to uploads | Storage keys in the path, `name` query | `classifyUploadKey` and `resolveImageAccess` (`apps/web/lib/posts/image-access.ts`) |
| Stripe to webhooks | Raw body plus `stripe-signature` | `Stripe.webhooks.constructEvent` on the raw text (`packages/payments/src/stripe-gateway.ts`), then a Zod event schema |
| API and services to Postgres | SQL through Drizzle | `runInCommunity` sets `app.community_id` per transaction; RLS is forced on every tenant table |
| Worker to Postgres | Job payloads | `postEventsJobPayloadSchema` and friends (`packages/events/src/schema.ts`, `apps/worker/src/jobs/*.ts`) |
| Server to SMTP | Rendered templates | `emailMessageSchema` (`packages/email/src/message.ts`), HTML escaped in `packages/email/src/templates/html.ts` |
| Server to storage | Bytes, keys | `parseStorageKey`, `validateImage`, `validateAttachment` (`packages/storage/src/*`) |
| Agent to API and MCP | Bearer tokens, OAuth access tokens, JSON bodies, tool arguments | `bearer` middleware resolves the token to an agent or person and its scopes (`packages/api/src/middleware/bearer.ts`); MCP tool calls become the same REST requests (`packages/mcp/src/dispatch.ts`), so route schemas, scope checks, and the approval catalog apply once |
| Worker to webhook receivers | Event payloads | Payloads carry ids and minimal fields, signed with a per endpoint secret (`packages/webhooks/src/*`); destinations pass `@cohory/egress` before any connection |
| Environment to process | Env vars | Zod env parsers per package (`packages/*/src/env.ts`, `packages/payments/src/config.ts`, `apps/worker/src/env.ts`) |

## 4. STRIDE per boundary

S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege.

### 4.1 Browser to Next server and API

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| S | Session cookie theft or forgery | Better Auth signed session token, `httpOnly`, `sameSite=lax`, `secure` under HTTPS (`node_modules/better-auth/dist/cookies`), secret of at least 32 chars (`packages/auth/src/env.ts`) | In place |
| S | Cross site request forgery on `/api/auth` | Better Auth origin check against `baseURL` (`originCheckMiddleware`); server actions are same origin by Next design | In place |
| S | Credential stuffing on sign in | Per address limits on sign up, sign in, and reset (`apps/web/lib/auth/rate-limit.ts`, `packages/rate-limit/src/config.ts`) | In place; see review F-02 for the forwarded header fix |
| T | Open redirect through `next=` | `safeRedirectPath` (`packages/auth/src/redirects.ts`) | In place |
| T | Clickjacking | `X-Frame-Options: DENY` and `frame-ancestors 'none'` (`apps/web/lib/security-headers.ts`) | In place since this review |
| T | Forged client address to dodge limits | Last `X-Forwarded-For` entry (`packages/rate-limit/src/limiter.ts`) | In place since this review |
| I | Account enumeration through reset | Reset answers the same for unknown addresses and sends nothing (`packages/auth/src/auth.integration.test.ts`) | In place |
| I | Account enumeration through sign up | `autoSignIn` is off, so sign up answers 200 with the same shape for new and existing addresses and the owner of an existing address gets an email instead (`packages/auth/src/auth.integration.test.ts`). Signing in afterwards with a guessed password still tells a new account from an existing one; the sign up and sign in rate limits bound that | Fixed, review F-05 (0.9.0) |
| I | Account enumeration through community owner tools | On Cloud (founder decision 2026-10-21) owner and admin tools never show whether an address outside the community has an account: the members CSV preview shows one status for every address that is not a member or banned, subscriber linking matches only members, archive and platform import preview counts include only the owner's own account, and comped access by email answers the same for every address. Rows 74 and 75 cover the sign in side; any signed in person can create a community, so these tools counted as the same oracle | In place on Cloud. The Community Edition keeps the account hints for self hosted owners |
| I | Stack traces or other tenants' ids in errors | `toApiError` maps every error to a fixed code and message, 500 logs only the error name (`packages/api/src/errors.ts`) | In place |
| D | Oversized bodies | Server action body limit 6 MB (`apps/web/next.config.ts`), avatar 5 MB, attachment 25 MB, storage upload limit 10 MB in `.env.example` (25 MiB when `STORAGE_MAX_UPLOAD_BYTES` is unset) | In place |
| E | Hidden button, direct call | Every service calls `assertCan` with the actor's active role (`packages/*/src/service*`); UI checks are not relied on | In place |
| E | Moderator promotes self, admin transfers ownership | Rules `target_member`, `target_member_or_moderator`, `target_not_owner`, `assign_admin` owner only (`packages/authz/src/matrix.ts` lines 46 to 61), `packages/communities/src/manage/people.ts` | In place |
| E | Invite grants a staff role | Redemption always activates as `member` (`packages/communities/src/manage/invites.ts`, `activate`) | In place |
| E | Banned member rejoins by invite or purchase | `redeemInvite` refuses banned members and banned emails, checkout refuses banned members (`packages/payments/src/service/membership.ts` line 84) | In place |

### 4.2 Content and uploads

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| T | Stored XSS in posts | Posts are a structured document, text is rendered by React, links carry `rel` and are validated (`apps/web/lib/posts/document.ts`, `packages/ui/src/community/content.ts`) | In place |
| T | Stored XSS in lessons | markdown-it with `html: false`, `validateLink` allows `http`, `https`, `mailto` and relative paths, images limited to uploads or an allowlist of hosts (`packages/courses/src/markdown.ts`) | In place |
| T | Malicious embed | `resolveEmbed` accepts only YouTube, Vimeo, and Loom ids over HTTPS, iframes are sandboxed (`packages/ui/src/community/content.ts`, `post-content.tsx`) | In place |
| T | Polyglot upload executed in the browser | Magic bytes must match the declared type (`packages/storage/src/images.ts`, `attachments.ts`), no SVG or HTML types, served with `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` (`apps/web/app/api/uploads/[...key]/route.ts`) | In place |
| T | Path traversal in storage keys | Segment pattern, `..` rejected, resolved path must stay under the root (`packages/storage/src/keys.ts`, `local.ts`) | In place |
| T | CSV formula injection in the members export | Cells starting with `=`, `+`, `-`, `@`, tab, or CR are prefixed with a quote (`packages/communities/src/manage/csv.ts`) | In place |
| I | Private community image fetched by URL | Post images resolve access through the posts service, attachments through the courses service, private responses carry `Vary: Cookie` and `Cache-Control: private` | In place |
| I | SSRF through link previews or avatar URLs | No server side fetch of user supplied URLs exists in 0.1.0 (verified by grep for `fetch(` outside the browser) | Not applicable yet; the egress helper in [agent-integrations](../architecture/agent-integrations.md) section 9 was planned (as of 0.11.0 it exists as `@cohory/egress` and guards outbound webhook deliveries) |

### 4.3 Services to Postgres

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| T, I | Query without a tenant filter | `runInCommunity` requires a parsed `CommunityId` and adds `where community_id = ...` (`packages/db/src/tenancy/scope.ts`); RLS forced on every tenant table from its first migration (`packages/db/migrations/*.sql`) | In place |
| E | App role bypasses RLS | Role created with `NOSUPERUSER NOBYPASSRLS` (`packages/db/src/app-role.ts`), proven by `packages/db/src/tenancy/app-role.integration.test.ts` | In place |
| E | Request path sets a manager flag | `app.*_manager`, `app.calendar_jobs`, `app.payments_webhook`, `app.outbox_relay` are set only inside repository functions after the service called `assertCan`, through the typed `setRlsFlag` family in `packages/db/src/tenancy/session.ts`, the only source file that calls `set_config` (a test enforces it); no HTTP input reaches it | In place |
| T | Forged scope object | `requireCommunityScope` validates the brand at runtime (`packages/db/src/tenancy/tenancy.integration.test.ts` "rejects a forged scope") | In place |
| I | Guessable ids | UUIDv7 everywhere (`packages/db/src/ids.ts`); no route grants access on id secrecy alone, every read goes through policy | In place |
| R | Staff actions without a trail | `audit_log` is append only under RLS, readable by managers (`packages/db/migrations/0009_manage_invites_audit_appearance.sql`) | In place for manage actions |

### 4.4 Stripe to webhooks and the payments module

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| S | Forged webhook | Signature verified on the raw body with each configured secret before parsing (`packages/payments/src/stripe-gateway.ts` `verifyStripeWebhook`) | In place |
| T | Replayed event | Stripe tolerance of 300 seconds, `provider_events` unique on `(provider, external_event_id)` with a two minute lease (`packages/payments/src/service/webhooks.ts`) | In place |
| T | Trusting amounts from the event body | Subscription state is re-fetched from Stripe before it is stored (`syncSubscription`) | In place |
| T | Fee computed outside the fee module | `packages/payments/src/fee.ts` is the only place; rate from `PLATFORM_FEE_BPS`, Community Edition 0 | In place |
| E | Portal or checkout for another member's customer | Customer looked up by `(userId, connectionId)` inside the tenant transaction (`membership.ts` lines 104 and 149) | In place |
| I | Creator keys at rest | AES-256-GCM with the connection id as associated data (`packages/payments/src/crypto.ts`) | In place |
| T | Live keys outside production | `assertTestModeKey` (`packages/payments/src/config.ts`) | In place |
| E | Creator disconnects but fee continues | The disconnect exit run removes `application_fee_percent` from every subscription and verifies it before the connection closes; fees Stripe reports afterwards are refunded; `account.application.deauthorized` closes the connection and emails the owner ([payments](../architecture/payments.md) section 12.8) | In place since Step 18, closes review P-01 |

### 4.5 Worker, SMTP, and object storage

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| T | Malformed job payload | Zod on every handler (`apps/worker/src/jobs/*.ts`) | In place |
| I | Secrets in logs | `@cohory/infra/logger` redacts `password`, `token`, `secret`, `authorization`, `cookie` at any depth in every process (`packages/infra/src/logger.ts`), and `no-console` keeps sources on it; auth mail failures log only the reason (`packages/auth/src/options.ts`) | In place |
| T | Header injection in email | `to` must be an email, templates escape HTML, nodemailer encodes headers | In place |
| I | Public bucket exposure | Local driver by default, S3 served through `/api/uploads` unless `S3_PUBLIC_URL` is set by the operator | In place |

### 4.6 Agents, API tokens, and MCP

| Threat | Example | Control | Status |
|--------|---------|---------|--------|
| S | Guessed or leaked token | Tokens are 32 random bytes with a prefix, stored only as a SHA-256 hash and compared in constant time (`packages/agents/src/token.ts`); revoked and expired tokens, revoked or paused agents, and tokens whose owner lost the membership are refused (`packages/agents/src/authenticate.ts`) | In place |
| S | A client impersonating an MCP user | OAuth 2.1 with PKCE and registered redirect URIs on the built in authorization server (`packages/agents/src/oauth/authorize.ts`, `redirect-uri.ts`); consent names the community, the agent, and the scopes ([0020](../decisions/0020-oauth-authorization-server.md)) | In place |
| E | Agent exceeds its scopes or role | Every route carries a scope and a policy action (`packages/api/src/route-meta.ts`); `assertCan` runs with the owning human's role, so a demoted owner demotes the agent (`agent-safety.integration.test.ts`) | In place |
| E | Agent acts on money, roles, removals, deletions, or settings | Those operations are classified in the approval catalog (`packages/api/src/approvals/catalog.ts`); the agent gets 202 `pending_approval` and a person replays the recorded request as themselves ([0018](../decisions/0018-approvals-replay-recorded-requests.md)); archive, delete, ownership transfer, and Stripe connection are never grantable | In place |
| T | Tampered or replayed approval | The recorded request is stored with the agent and the approver, runs once, expires after 72 hours, and is written to the audit log with the decision | In place |
| D | Token or agent floods | 60 requests a minute per token and 30 agent writes an hour (`packages/rate-limit/src/config.ts`, `RATE_LIMIT_API_TOKENS`, `RATE_LIMIT_AGENT_WRITES`), at most 20 pending approvals per agent, body and page size caps | In place |
| I | Cross tenant reads by id | Tokens belong to one community; routes resolve objects inside that community's transaction under RLS (`agent-safety.integration.test.ts` "does not reach another community's posts, approvals, webhooks, or scheduled posts by id") | In place |
| R | Agent writes without a trail | Every agent write, approval request, and decision is in `audit_log` with `actorType = agent`, `via`, the token id, and the owning human ([agent-integrations](../architecture/agent-integrations.md) section 5) | In place |
| T | Prompt injection through content an agent reads | Rich text and lesson bodies are marked untrusted user data in the OpenAPI document; the server never executes instructions found in content; agent course material is a separate, reviewed surface ([review-agent-courses](review-agent-courses.md)) | In place; the agent side stays the client's duty |
| I, S | Outbound webhooks reach internal hosts or are forged | `@cohory/egress` blocks loopback, private, link local, metadata, and reserved ranges for every resolved address and pins the connection; payloads are signed with HMAC SHA-256 per endpoint and receivers verify the timestamp ([webhooks](../operations/webhooks.md)) | In place |

## 5. Controls that exist, by file

| Control | File |
|---------|------|
| Permission matrix and `assertCan` | `packages/authz/src/matrix.ts`, `packages/authz/src/policy.ts` |
| Tenant scope and RLS variable | `packages/db/src/tenancy/scope.ts` |
| Application role without `BYPASSRLS` | `packages/db/src/app-role.ts` |
| RLS policies | `packages/db/migrations/*.sql`, from `0001` on, and the typed settings in `packages/db/src/tenancy/session.ts` |
| Better Auth options | `packages/auth/src/options.ts` |
| Safe redirects | `packages/auth/src/redirects.ts` |
| Auth rate limits | `apps/web/lib/auth/rate-limit.ts`, `packages/rate-limit/src/*` |
| API error mapping | `packages/api/src/errors.ts` |
| Upload validation and serving | `packages/storage/src/*`, `apps/web/app/api/uploads/[...key]/route.ts`, `apps/web/lib/posts/image-access.ts` |
| Lesson markdown | `packages/courses/src/markdown.ts` |
| Embeds | `packages/ui/src/community/content.ts` |
| CSV escaping | `packages/communities/src/manage/csv.ts` |
| Security headers | `apps/web/lib/security-headers.ts`, `apps/web/next.config.ts` |
| Webhook verification and dedupe | `packages/payments/src/stripe-gateway.ts`, `packages/payments/src/service/webhooks.ts` |
| Key encryption | `packages/payments/src/crypto.ts` |
| Live key refusal | `packages/payments/src/config.ts` |
| Token hashing and authentication | `packages/agents/src/token.ts`, `packages/agents/src/authenticate.ts`, `packages/api/src/middleware/bearer.ts` |
| OAuth authorization server | `packages/agents/src/oauth/*`, `packages/api/src/oauth.ts` |
| Scope and approval catalog | `packages/api/src/route-meta.ts`, `packages/api/src/approvals/catalog.ts` |
| Token and agent rate limits | `packages/rate-limit/src/config.ts` |
| Outbound webhook signing and egress | `packages/webhooks/src/*`, `packages/egress/src/*` |
| Log redaction in every process | `packages/infra/src/logger.ts` (the worker wraps it in `apps/worker/src/logger.ts`) |

## 6. Out of scope

- The agent side of prompt injection: what an assistant does with content it reads is the client's duty. The server side is in section 4.6, the untrusted input rules in [agent-integrations](../architecture/agent-integrations.md) section 9, and [review-agent-courses](review-agent-courses.md).
- Two factor authentication and social sign in (no providers configured, `packages/auth/src/options.test.ts`).
- Platform administration paths that read across tenants (`platformAdmin` is always `false` in `apps/web/lib/actor.ts` and `packages/api/src/middleware/session.ts`).
- Denial of service through volume. Rate limits are per process and in memory ([self-hosting](../self-hosting.md)).

## Decisions and open questions

- **Recommendation:** keep this document in step with each migration and each new delivery surface. A PR that adds a boundary updates section 3.
- **Decided (0.9.0):** every page carries an enforced Content Security Policy from `apps/web/proxy.ts`: scripts need the per request nonce (`'strict-dynamic'`, no `'unsafe-inline'`, `'unsafe-eval'` only in development), `connect-src 'self'`, frames only from the YouTube, Vimeo, and Loom embed hosts, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. Styles keep `'unsafe-inline'` for React style attributes. There is no `form-action`, because the OAuth consent form redirects to the client's own callback. The end to end suite fails on any policy violation in the browser console.
- **Open question:** whether to add a platform role with `BYPASSRLS` for operator tooling, or keep operators on `psql` as the schema owner.
