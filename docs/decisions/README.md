# Architecture decision records

How Cohory records architecture decisions, the template to use, and the index of all ADRs.

ADRs explain why the system is shaped the way it is. The architecture itself is described in [../architecture/overview.md](../architecture/overview.md).

## When to write an ADR

Write an ADR when a decision:

- is expensive to reverse (database, framework, tenancy model, license, payment model),
- crosses module boundaries or changes a public contract (API, export format, plugin hooks),
- touches money, authentication, authorization, or tenant isolation, or
- picks between alternatives that reasonable contributors would argue about.

Do not write an ADR for choices a code review can settle (a helper name, a library for date formatting).

## Process

1. Copy the template below into `docs/decisions/NNNN-short-slug.md`. `NNNN` is the next free number, zero padded to four digits. Numbers are never reused.
2. Set the ADR status to **Proposed** and open a pull request. The PR description links the ADR and the discussion.
3. Discussion happens in the PR. Change the ADR as the discussion changes the decision.
4. A maintainer sets the status to **Accepted** when merging, or closes the PR. Decisions reserved for the founder (license, pricing, payment model) need the founder's explicit approval in the PR.
5. To change an accepted decision, write a new ADR. Set the old one to **Superseded by NNNN** and link both ways. Accepted ADRs are not edited except for the status line and links.
6. Add the ADR to the index table below in the same PR.

Statuses:

| Status | Meaning |
|---|---|
| Proposed | Drafted, under discussion, not yet binding |
| Accepted | Binding. Code and docs must follow it. |
| Superseded | Replaced by a later ADR, kept for history |

The labels **Confirmed**, **Recommendation**, **Assumption**, and **Open question** keep their meaning from the rest of the documentation. An ADR is Accepted when its core decision is Confirmed by the founder brief. Details inside it may still be Recommendation or Open question.

## Template

MADR-style, shortened.

```markdown
# NNNN. Title in sentence case

One-line summary of the decision.

- ADR status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: names or roles
- Related: links to docs and other ADRs

## Context

The forces at play: requirements, constraints, facts. Cite requirement IDs.

## Decision

What we will do, stated plainly.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|

## Consequences

Positive, negative, and follow-up work.

## Open questions

What is still undecided and who decides.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith | Accepted |
| [0002](0002-nextjs-app-router-and-hono-api.md) | Next.js App Router with a Hono API | Proposed |
| [0003](0003-drizzle-orm.md) | Drizzle ORM over Prisma | Accepted |
| [0004](0004-better-auth.md) | Better Auth for authentication | Accepted |
| [0005](0005-postgres-job-queue.md) | pg-boss job queue by default, BullMQ optional | Proposed |
| [0006](0006-shared-database-multi-tenancy.md) | Shared database multi-tenancy with `community_id` and RLS | Proposed |
| [0007](0007-stripe-connect-direct-charges.md) | Stripe Connect with direct charges and a 2% application fee | Accepted |
| [0008](0008-platform-fee-ledger.md) | Platform fee ledger | Accepted |
| [0009](0009-license.md) | License: AGPL-3.0 core and MIT SDK | Accepted (founder, 2026-10-19; plugin exception wording awaits legal review) |
| [0010](0010-uuidv7-primary-keys.md) | UUIDv7 primary keys | Proposed |
| [0011](0011-mcp-first-class-api-surface.md) | MCP as a first-class API surface | Accepted |
| [0012](0012-post-content-format.md) | Post content format | Proposed |
| [0013](0013-domain-event-dispatch.md) | Domain event dispatch | Proposed |
| [0014](0014-transactional-outbox.md) | Transactional outbox for domain events | Accepted |
| [0015](0015-migration-module-direct-table-access.md) | Migration module reads and writes module tables directly | Accepted |
| [0016](0016-database-triggers-append-domain-events.md) | Database triggers append membership, lesson, RSVP, and subscription events | Accepted (founder, 2026-10-19) |
| [0017](0017-bearer-api-tokens.md) | Bearer API tokens and agent identities on /api/v1 | Accepted (founder, 2026-10-19) |
| [0018](0018-approvals-replay-recorded-requests.md) | Approvals replay the recorded API request as the approving person | Accepted (founder, 2026-10-19) |
| [0019](0019-mcp-dispatch-through-http-handlers.md) | MCP tools dispatch through the REST handlers | Accepted (founder, 2026-10-19) |
| [0020](0020-oauth-authorization-server.md) | Built in OAuth authorization server for MCP clients | Accepted (founder, 2026-10-19) |
| [0021](0021-agent-course-format-and-storage.md) | Agent course format 1.0.0, immutable snapshots, and Agent Skills export | Accepted (founder, 2026-10-19) |
| [0022](0022-delegated-entitlements.md) | Delegated course entitlements derived on every check | Accepted (founder, 2026-10-19) |
| [0023](0023-agent-course-delivery.md) | Agent course delivery: tools on REST routes, signed links, one license source, and lapsed agents | Accepted (founder, 2026-10-19) |
| [0024](0024-shared-content-package.md) | Shared content package | Proposed |
| [0025](0025-reviews-module-boundary.md) | Reviews module: tenure from Payments, standing from a membership trigger, and its own report table | Draft |
| [0026](0026-community-page-for-non-members.md) | Community page for non-members: an About tab first, a join hero, and join continuation after sign up | Draft (one join button and the About section contents superseded by 0036) |
| [0027](0027-safe-exit-and-2-percent-fee.md) | Safe exit for paid communities, the 2% Cloud fee, and Polar off by default | Accepted (founder, 2026-10-20) |
| [0028](0028-stripe-disputes.md) | Stripe disputes: notify the owner, mark the payment disputed, refund the platform fee on a lost dispute, never revoke access | Accepted (founder, 2026-10-22) |
| [0029](0029-remove-or-ban-ends-billing.md) | Removing or banning a paying member ends their subscription now, without proration or refund | Accepted (founder, 2026-10-22) |
| [0030](0030-payment-webhooks-in-the-worker.md) | Payment webhooks are stored and queued in the request and processed in the worker; a daily job reconciles each connection | Accepted (founder, 2026-10-22) |
| [0031](0031-community-access-module.md) | Entitlements answers community access for every module through `@cohory/entitlements/access`, applying the paid access rule; the default delegation service moves to `@cohory/courses/entitlements` | Accepted (2026-10-22; delegation service wiring superseded by 0044) |
| [0032](0032-error-catalog-and-list-shape.md) | One error catalog shared by the API and the web app, one `{ data, nextCursor }` list shape, and a rendered API reference | Accepted (2026-10-22) |
| [0033](0033-platform-config-and-neutral-home.md) | One platform config, a neutral edition aware home, and instance branding | Accepted (founder, 2026-10-22); Superseded in part by 0047 |
| [0034](0034-notification-types-and-weekly-digest.md) | New notification types for joins, likes, reports, and money events, grouped notices, failed payment emails, and a combined weekly digest | Accepted (founder, 2026-10-22) |
| [0035](0035-email-suppression-and-delivery-headers.md) | Email suppression list in the shared mailer (security email exempt), throttled SMTP pool, community opt out, and list and thread headers | Accepted (founder, 2026-10-22) |
| [0036](0036-about-page-that-sells.md) | An About page that sells: join in reach, What you get, About the host, Questions, and one editor (supersedes parts of 0026) | Accepted (founder, 2026-10-22; private community sharing superseded by 0041) |
| [0037](0037-paid-join-rules.md) | Paid join rules: payment is the approval, invite only gates checkout, join questions before checkout, and draft prices before Stripe is ready | Accepted (founder, 2026-10-22) |
| [0038](0038-email-verification-required.md) | A confirmed email is required to sign in whenever the server sends email; magic link sign in, change email, a password changed email, and account emails on a retried `email.send` job | Accepted (founder, 2026-10-22) |
| [0039](0039-legal-pages-and-data-rights.md) | Operator configurable legal pages and footer, consent and minimum age at sign up, Creator Terms before Stripe Connect, seller and refund line at checkout, download your data, report content, and security.txt | Accepted (product decisions 1 and 2, 2026-10-22) |
| [0040](0040-fair-cancel-and-pause.md) | Member billing: the price on the membership, billing entry points, one fair cancel screen with switch to yearly and pause (Stripe `pause_collection`), and a yearly renewal reminder | Accepted (product owner, 2026-10-22) |
| [0041](0041-private-community-link-previews.md) | A private community shares nothing about itself in link previews, its About page included (supersedes part of 0036) | Accepted (coordinator, 2026-10-22) |
| [0042](0042-moving-paying-members.md) | Moving paying members: no linking on Cloud, free time at Checkout until the old renewal date, a list of who still needs to move, and a reminder email | Accepted (founder, 2026-10-22) |
| [0043](0043-import-invitations-and-emails.md) | Imports invite people instead of adding them on Cloud; the owner chooses whether import emails go out now, later, or never, with a note, a preview, a test, sending later from Import history, and resending to one person | Accepted (founder, 2026-10-23) |
| [0044](0044-composition-roots-and-shared-infrastructure.md) | One composition root per process (`@cohory/api/services`, the worker's `services.ts`), typed row level security session settings in `@cohory/db`, one logger in `@cohory/infra/logger`, one definition per worker job, and large files split by sub area (supersedes the delegation service wiring in 0031) | Accepted (2026-10-23) |
| [0045](0045-levels-that-unlock-and-learning-points.md) | Courses locked until a level through the access module, one point per finished lesson and attended event (a going RSVP on an ended occurrence) awarded by a worker job, and a level ladder on the leaderboard | Accepted (founder and coordinator, 2026-10-22) |
| [0046](0046-test-slots-and-host-e2e.md) | A machine wide pool of 2 test slots, `pnpm e2e:host` against the cached build for the inner loop, `pnpm e2e` on the image as the gate, and `pnpm stack:dev` | Accepted (founder, 2026-10-22) |
| [0047](0047-cloud-marketing-in-the-app.md) | Cloud marketing pages (`/` signed out, `/pricing`, `/open-source`) in the app, shown only on the Cloud Edition, with the fee and limits read from config; `MARKETING_URL` removed (supersedes part of 0033) | Accepted (founder, 2026-10-23) |
| [0048](0048-creators-community-invitation.md) | `CREATORS_COMMUNITY_SLUG` adds the creators community to every footer and invites each new creator once (after the first published post or course, or after 3 days) through an ordinary single use invite link whose token is derived from the person | Accepted (founder, 2026-10-23) |
| [0049](0049-creator-feedback.md) | Cloud only creator feedback: moment questions after a first post, paid member, and course, optional exit reasons, a user owned `creator_feedback` table with forced RLS on `app.user_id`, 24 month retention, and answers emailed to `CONTACT_EMAIL` | Proposed |
| [0050](0050-restricted-cloud-community-creation.md) | Cloud keeps sign up open but limits community creation to design partners (`COMMUNITY_CREATION=operators`) until it opens; the landing page shows Request early access and Self-host now while creation is restricted | Proposed |

## Decisions and open questions

| Label | Item |
|---|---|
| Recommendation | MADR-style template, four-digit numbering, statuses Proposed, Accepted, Superseded. |
| Recommendation | Decisions on license, pricing, and payment model need the founder's explicit approval. |
| Open question | Who besides the founder can accept ADRs once outside maintainers join (see [GOVERNANCE.md](../../GOVERNANCE.md)). |
