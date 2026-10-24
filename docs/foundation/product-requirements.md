# Product requirements

Functional and non-functional requirements for Cohory, grouped by module, with priorities and acceptance notes.

The MVP cut is summarized in [../product/mvp-scope.md](../product/mvp-scope.md). Data structures are in [../architecture/data-model.md](../architecture/data-model.md). Permissions are in [../architecture/authorization.md](../architecture/authorization.md).

## How to read this document

- Each requirement has an ID (`REQ-<MODULE>-<NNN>`), a priority, and acceptance notes.
- Priorities: **MVP** (needed for the first public release, roadmap Phases 0 to 4), **Post-MVP** (Phases 5 to 6 or small follow-ups), **Long-term** (Phase 7 and beyond).
- Requirements listed under the MVP scope in the brief are **Confirmed** in scope. The specific wording, limits, and acceptance notes are **Recommendation** unless marked otherwise.
- IDs are stable. Removed requirements are marked "Withdrawn", not renumbered.

## Goals

1. A non-technical creator can launch a paid community (posts, a course, an event, a paid tier) without documentation.
2. Members can read, post, learn, and join events from a phone with four tabs.
3. The same codebase runs as the Community Edition (self-hosted, 0% platform fee) and the Cloud Edition (managed, 2% platform fee on successful transactions, processing fees separate).
4. Subscriptions created through Cohory live in the creator's payment account.
5. Every capability is available through a documented API.

## Non-goals

See [mission.md](mission.md) for the full list with reasons. In short: no native apps, no real-time chat, no funnels or email marketing, no advanced analytics, no automation builder, no plugin marketplace, and no hosted agent execution in MVP.

## Actors

| Actor | Description |
|---|---|
| Visitor | Not signed in. Sees public community pages and pricing. |
| Member | Belongs to a community. Access depends on entitlements. |
| Moderator | Member with moderation rights in one community. |
| Admin | Staff with Manage access in one community, without payment ownership. |
| Creator | Owns the community and its payment connection. |
| Agent | AI actor with its own identity, an owning human, and scoped permissions. |
| Operator | Runs a Community Edition instance (server level, not community level). |

## Functional requirements

### Identity

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-ID-001 | Sign up and sign in with email and password. | MVP | Password rules follow current NIST guidance (length over complexity). Email verification required before joining a paid tier. |
| REQ-ID-002 | Sign in with a magic link. | MVP | Link expires in 15 minutes and is single use. |
| REQ-ID-003 | Sign in with at least one OAuth provider. | Post-MVP | Phase 5. Google at minimum. Providers configurable by operators via environment variables. Out of MVP per [../product/mvp-scope.md](../product/mvp-scope.md) section 2.1. |
| REQ-ID-004 | One account across communities on the same instance. | MVP | A member of two communities signs in once and switches from My Communities. |
| REQ-ID-005 | Profile with name, avatar, short bio, time zone. | MVP | Time zone detected on first sign in, editable. |
| REQ-ID-006 | Session management: list and revoke active sessions. | MVP | Revoking signs out that device within one request. |
| REQ-ID-007 | Personal data export and account deletion. | MVP | Export as JSON within 24 hours. Deletion anonymizes authored content per community policy and keeps financial records required by law. |
| REQ-ID-008 | Two-factor authentication (TOTP). | Post-MVP | Out of MVP per [../product/mvp-scope.md](../product/mvp-scope.md) section 2.1. **Recommendation:** once shipped, required for owners who have connected a payment account, optional for members. Until then, payment actions require recent re-authentication ([../architecture/authorization.md](../architecture/authorization.md) section 10). |
| REQ-ID-009 | Passkeys. | Post-MVP | Via Better Auth support. |
| REQ-ID-010 | SAML or OIDC single sign-on per community. | Long-term | For organizations (Persona 6). |

### Communities

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-COM-001 | Create a community with name, URL slug, description, and privacy (public or private). | MVP | Done in one form with at most four fields shown. Slug validated for uniqueness instantly. |
| REQ-COM-002 | Default content on creation: three categories (General, Introductions, and Announcements, which is admin-only), a suggested introduction post, default level names. | MVP | Creator can edit or delete all defaults. |
| REQ-COM-003 | Appearance: accent color, logo, cover image, one of three fonts, card style (Soft or Minimal), Light, Dark, or System. | MVP | Accent contrast validated per [../brand/design-tokens.md](../brand/design-tokens.md). Layout never changes. |
| REQ-COM-004 | Member navigation is exactly Community, Classroom, Calendar, Members. | MVP | **Confirmed.** No configuration can add a fifth tab. Mobile uses bottom navigation. |
| REQ-COM-005 | Manage area with Overview, People, Payments, Appearance, Settings, Migration. | MVP | **Confirmed.** Visible only to creators and admins. Migration is its own section (founder decision, 2026-10-19). As built in 0.11.0, Inbox sits second, and moderators see Inbox and People only. |
| REQ-COM-006 | Public about page with description, pricing, and join button. | MVP | Renders for visitors without JavaScript. |
| REQ-COM-007 | Custom domain per community. | Post-MVP (founder decision, 2026-10-25; not built as of 0.12.0) | Cloud: automatic TLS. Community Edition: operator configures reverse proxy, documented. |
| REQ-COM-008 | Transfer community ownership to another member. | MVP | Requires the new owner to connect their own payment account. Existing subscriptions are not moved automatically. |
| REQ-COM-009 | Archive and delete a community. | MVP | Deletion offers export first, cancels future fees, and warns about active subscriptions. |
| REQ-COM-010 | White labeling (remove Cohory branding). | Post-MVP | Agency direction. |

### Members

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-MEM-001 | Join a free community in one step after sign in. | MVP | Private communities support request to join with optional questions (up to three). |
| REQ-MEM-002 | Invite by shareable link (MVP) and by email in bulk (Post-MVP). | MVP (link), Post-MVP (bulk email) | Links can expire and be revoked. |
| REQ-MEM-003 | Approve, remove, and ban members. | MVP | Removing or banning a paying member ends their subscription now, without proration or refund, and the dialog says so before confirming ([0029](../decisions/0029-remove-or-ban-ends-billing.md)). Ban blocks rejoin with the same account and email. |
| REQ-MEM-004 | Roles: owner (the creator), admin, moderator, member, plus guest as the non-member state. | MVP | Permissions per [../architecture/authorization.md](../architecture/authorization.md). Only the owner manages payments. |
| REQ-MEM-005 | Member directory with search by name and filter by level and membership. | MVP | Paginated, works for 10,000 members. |
| REQ-MEM-006 | Member profile within a community: bio, level, join date, recent activity. | MVP | Shows only activity in this community. |
| REQ-MEM-007 | Export members as CSV. | MVP | Includes email, name, join date, membership, level, and Stripe customer and subscription IDs. Available to the owner only. JSON is part of the full archive export (REQ-MIG-001, Phase 5). |
| REQ-MEM-008 | Find inactive members (no visit or post in N days). | Post-MVP | Also exposed to agents (Agent integrations). |

### Posts

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-POST-001 | Create a post with optional title, rich text body, category, and up to 10 images. | MVP | File attachments on posts are Post-MVP. From the feed in one or two interactions. Draft saved locally while typing. |
| REQ-POST-002 | Feed sorted by recent activity, with filter by category. | MVP | Cursor pagination. First page renders on the server. |
| REQ-POST-003 | Like a post. | MVP | Optimistic update. A like awards a point to the author (see Gamification). |
| REQ-POST-004 | Pin posts (creator and admins). | MVP | Up to three pinned posts per community. |
| REQ-POST-005 | Edit and delete own posts. Moderators can delete any post. | MVP | Edits show an "edited" marker. Deletes are soft for 30 days. |
| REQ-POST-006 | Embeds for video links (YouTube, Vimeo, Loom, Wistia). | MVP | No third-party scripts loaded until the member clicks play. Link preview cards are Post-MVP. |
| REQ-POST-007 | Mentions of members with notification. | MVP | Autocomplete limited to members of the same community. |
| REQ-POST-008 | Category permissions (for example, only admins post in Announcements). | MVP | Default: Announcements is admin-only. |
| REQ-POST-009 | Polls. | Post-MVP | Single choice only at first. |
| REQ-POST-010 | Scheduled posts. | Post-MVP | Also used by agents for drafted announcements. |
| REQ-POST-011 | Search posts, members, and course and lesson titles. | MVP | PostgreSQL full-text search. Scoped to the community and the member's entitlements. |
| REQ-POST-012 | Report a post for moderation. | MVP | Reports appear in Manage, Inbox, Reports. |

### Comments

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-CMT-001 | Comment on posts. | MVP | One level of replies (comment and reply). Lesson comments are Post-MVP (REQ-LSN-004). |
| REQ-CMT-002 | Like comments. | MVP | Awards a point to the author. |
| REQ-CMT-003 | Edit and delete own comments. Moderators can delete any comment. | MVP | Same rules as posts. |
| REQ-CMT-004 | Mark a comment as the answer on a question post. | Post-MVP | Optional per category. |
| REQ-CMT-005 | Comment notifications to post author and thread participants. | MVP | Respect notification preferences. |

### Courses

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-CRS-001 | Create a course with title, description, cover, and modules. | MVP | Created inside Classroom, not Manage. |
| REQ-CRS-002 | Access rules per course: open to all members, specific membership tiers, minimum level, or one-time purchase. | MVP (all members only), Post-MVP (tiers, level, one-time purchase) | Rules resolve through Entitlements. |
| REQ-CRS-003 | Reorder modules and lessons by drag and drop and by keyboard. | MVP | Keyboard reordering is required for accessibility. |
| REQ-CRS-004 | Course progress per member. | MVP | Percentage complete shown on CourseCard. |
| REQ-CRS-005 | "Continue" entry point from the Community homepage. | MVP | Shows the most recent incomplete lesson. |
| REQ-CRS-006 | Drip release by date or by days since joining. | Post-MVP | |
| REQ-CRS-007 | Course export as Markdown with front matter plus media. | Post-MVP | Phase 5. Part of the community export bundle (REQ-MIG-001). |
| REQ-CRS-008 | Agent-readable course format (structured references, exercises, evaluations). | Long-term | See Agent integrations and [roadmap.md](roadmap.md) Phase 7. |

### Lessons

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-LSN-001 | Lesson with title, markdown body, optional video, and downloadable resources. | MVP | Video by URL from the post embed allowlist. Up to 10 attachments of 25 MB each. Video upload and transcoding are Post-MVP (**Recommendation**). |
| REQ-LSN-002 | Mark lesson complete. | MVP | Manual in MVP. Completion updates progress immediately. Automatic completion at the end of a video is Post-MVP. |
| REQ-LSN-003 | Lesson player focused on content: no feed, no sidebar distractions on mobile. | MVP | Previous and next controls. Keyboard controls. Captions when a caption file exists. |
| REQ-LSN-004 | Lesson comments. | Post-MVP | Uses Comments module. |
| REQ-LSN-005 | Draft and published states. | MVP | Drafts visible only to creators and admins. |
| REQ-LSN-006 | Quizzes. | Post-MVP | Multiple choice first. |
| REQ-LSN-007 | Exercises and evaluations usable by agents. | Long-term | Phase 7. |

### Events

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-EVT-001 | Create an event with title, description, start, duration, time zone, location or join link. | MVP | Created inside Calendar. Times shown in the member's time zone. |
| REQ-EVT-002 | Simple recurrence: weekly, with an optional end date. | MVP | Cancel one occurrence or edit the whole series. Other patterns are Post-MVP. |
| REQ-EVT-003 | RSVP and reminders. | MVP | RSVP going or not going. Reminder email one hour before start for RSVP'd members. |
| REQ-EVT-004 | Access restriction by membership tier. | Post-MVP | Through Entitlements. Join link hidden from members without access. MVP has one paid plan, so all members see all events. |
| REQ-EVT-005 | Add to calendar (.ics download) and personal iCalendar feed. | MVP (.ics download), Post-MVP (feed) | Feed URL is secret per member and revocable. |
| REQ-EVT-006 | Attach a recording link after the event. | MVP | |
| REQ-EVT-007 | Built-in video calls. | Long-term | Not planned for MVP. External links only. |

### Gamification

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-GAM-001 | Points: one point per like received on posts and comments. | MVP | Self-likes give no points. Points are recorded as events, so totals can be recomputed. |
| REQ-GAM-002 | Levels 1 to 9 with default thresholds and creator-editable names. | MVP | Thresholds editable post-MVP. |
| REQ-GAM-003 | Leaderboard: rolling 7 days and all time. | MVP | Inside Members. Uses the Leaderboard component. A 30-day leaderboard is Post-MVP. |
| REQ-GAM-004 | Unlock a course at a minimum level. | Post-MVP | Through Entitlements. |
| REQ-GAM-005 | Creator can turn gamification off for the community. | MVP | Hides levels and leaderboard. The only gamification setting in MVP. |
| REQ-GAM-006 | Badges and custom point rules. | Post-MVP | Candidate for the plugin SDK. |

### Payments

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-PAY-001 | Cloud: connect the creator's Stripe account through Stripe Connect. | MVP | UI label "Connect your Stripe account". **Recommendation.** Accounts v2 connected account with full dashboard access, Stripe as fee collector and loss liable (see [../architecture/payments.md](../architecture/payments.md)), direct charges. The legacy Standard account type is deprecated for new platforms. |
| REQ-PAY-002 | Community Edition: connect the creator's own Stripe account with API keys, no platform fee. | MVP | **Confirmed** 0% platform fee. No Cohory service in the payment path. |
| REQ-PAY-003 | Cloud platform fee of 2% on successful transactions, collected as a Stripe application fee. | MVP | **Confirmed** rate. Fee base, rounding, refunds, and disputes per [business-model.md](business-model.md). |
| REQ-PAY-004 | Fee ledger: every platform fee, fee refund, and adjustment written as an append-only entry. | MVP | Reconciled daily against Stripe application fee objects. Mismatches alert. |
| REQ-PAY-005 | Checkout through Stripe hosted pages. | MVP | We never handle card data. |
| REQ-PAY-006 | Payments view showing gross, processing fees (as reported by the provider), platform fee, and net per transaction. | MVP | "Platform fee: 2%" label. |
| REQ-PAY-007 | Webhook processing is idempotent and replay safe. | MVP | Duplicate events produce no duplicate ledger entries. Covered by tests. |
| REQ-PAY-008 | Bring Your Own Payment Provider. | Post-MVP | Per-provider capability matrix. Ledger plus periodic billing when the provider cannot split fees. |
| REQ-PAY-009 | One-time purchases (courses, events). | Post-MVP | |
| REQ-PAY-010 | Disconnect payment account. | MVP | Explains effects in plain language. Removes application fees from future invoices of active subscriptions on Cloud. |

### Subscriptions

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-SUB-001 | Membership tiers: free, monthly, annual, in one currency per community. | MVP | Free tier plus one paid tier by default. |
| REQ-SUB-002 | Subscriptions created on the creator's connected account. | MVP | **Confirmed** as intent. Verified by integration test that the subscription object belongs to the connected account. |
| REQ-SUB-003 | Member self-service: cancel, update payment method through the Stripe customer portal. | MVP | Cancellation takes effect at period end by default. |
| REQ-SUB-004 | Failed payment handling. | MVP | Members keep access while the subscription is past due. Access ends when the subscription becomes unpaid or canceled, per the creator's Stripe retry settings. The member sees a banner and gets an email to update the payment method. **Recommendation:** a configurable cohory-side grace period (revoke after N days past due) is Post-MVP. |
| REQ-SUB-005 | Price changes apply to new subscribers only, unless the creator chooses to migrate existing ones. | MVP | Existing subscribers are never silently repriced. |
| REQ-SUB-006 | Free trials. | Post-MVP | |
| REQ-SUB-007 | Link existing Stripe subscriptions in the creator's account to members. | Post-MVP | "Bring your existing subscribers". Phase 5. |
| REQ-SUB-008 | Coupons and discounts. | Post-MVP | |

### Entitlements

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-ENT-001 | Entitlements derived from memberships, purchases, level, and manual grants. | MVP | One function answers "can this member access this resource". Covered by tests. |
| REQ-ENT-002 | Manual grant and revoke by creator or admin, with reason. | MVP | Logged in the audit log. |
| REQ-ENT-003 | Entitlement changes take effect within one minute of a payment event. | MVP | Webhook driven, with periodic reconciliation. |
| REQ-ENT-004 | Delegated entitlements to an agent owned by the member. | Long-term | Phase 7. Delegation is revocable and limited to read access to course content and exercises. |

### Notifications

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-NTF-001 | In-app notifications for replies, mentions, likes (grouped), event reminders, and approvals. | MVP | Bell inside the header, not a navigation tab. |
| REQ-NTF-002 | Email notifications, batched. | MVP | Sent through a background job. SMTP configurable on the Community Edition. Digest emails are Post-MVP. |
| REQ-NTF-003 | Per-community notification preferences. | MVP | One screen, plain language. |
| REQ-NTF-004 | Creator announcements by email to all members. | MVP | Rate limited. Unsubscribe link required. |
| REQ-NTF-005 | Web push notifications. | Post-MVP | |

### Migration

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-MIG-001 | Full community export as a versioned JSON bundle plus media in a ZIP. | Post-MVP | Phase 5. Located in Settings. Includes a schema version and a manifest. MVP ships the members CSV export (REQ-MEM-007). |
| REQ-MIG-002 | Import the Cohory export format into another instance. | Post-MVP | Round-trip test from Cloud to Community Edition is a release gate. |
| REQ-MIG-003 | Generic CSV import for members. | Post-MVP | Invitations sent only after creator confirmation. |
| REQ-MIG-004 | Skool and Circle importers for content and members. | Post-MVP | Limits of each source documented. No promise of payment method access. |
| REQ-MIG-005 | Payment migration: link existing Stripe subscriptions, or guide members to create a new subscription. | Post-MVP | Option A connect existing account, Option B Stripe account to account migration (provider assisted), Option C no payment method access. |
| REQ-MIG-006 | Cloud to self-hosted offboarding guide and tooling. | Post-MVP | Covers export, DNS, payment account reconnection, and fee removal. |

### Agent integrations

| ID | Requirement | Priority | Acceptance notes |
|---|---|---|---|
| REQ-AGT-001 | Public REST API v1 for MVP objects documented with OpenAPI 3.1. | Post-MVP | Phase 6. Served at `/api/openapi.json`. Read for all objects, write for posts, comments, events, members. The internal API that serves the web client exists from Phase 1 and its OpenAPI document is generated from the start, but external access and the stability promise arrive in Phase 6. |
| REQ-AGT-002 | Scoped API tokens per community. | Post-MVP | Phase 6. Scopes listed in [../architecture/authorization.md](../architecture/authorization.md). No wildcard scope. |
| REQ-AGT-003 | Audit log of sensitive actions. | MVP (admin actions), Post-MVP (API and agent actions) | Who, what, when, and via which token once tokens exist (Phase 6). Visible to the owner. |
| REQ-AGT-004 | Agent identities with an owning human, scopes, and revocation. | Post-MVP | Agents are not user accounts. |
| REQ-AGT-005 | MCP server exposing community, content, member, and event tools. | Post-MVP | Phase 6. Same authorization as REST. |
| REQ-AGT-006 | Human approval queue for sensitive agent actions. | Post-MVP | Money, roles, removals always need approval. |
| REQ-AGT-007 | Outbound webhooks for domain events. | Post-MVP | Signed payloads, retries with backoff. |
| REQ-AGT-008 | Agent-ready courses, SKILL.md generation, course to skill conversion, verified results. | Long-term | Phase 7. External content treated as untrusted. |

## Non-functional requirements

### Performance budgets

**Recommendation.** Measured at the 75th percentile on a mid-range mobile device over a fast 4G connection, against the reference deployment.

| ID | Budget |
|---|---|
| REQ-NFR-PERF-001 | Largest Contentful Paint under 2.5 s on Community feed, Classroom, Calendar, Members, and lesson pages. |
| REQ-NFR-PERF-002 | Interaction to Next Paint under 200 ms. Cumulative Layout Shift under 0.1. |
| REQ-NFR-PERF-003 | Initial JavaScript for member routes under 200 KB compressed. |
| REQ-NFR-PERF-004 | API p95 latency under 300 ms for reads and 500 ms for writes at the reference load. |
| REQ-NFR-PERF-005 | Reference load for the 2 vCPU, 4 GB deployment: 5,000 members and 100 concurrent active users with p95 targets met. To be confirmed by load test in Phase 4. |

### Accessibility

| ID | Requirement |
|---|---|
| REQ-NFR-A11Y-001 | WCAG 2.2 AA for all member and creator screens. |
| REQ-NFR-A11Y-002 | Automated checks in CI on every route group. Zero serious or critical violations to merge. |
| REQ-NFR-A11Y-003 | Manual keyboard and screen reader pass (VoiceOver and NVDA) per phase. |
| REQ-NFR-A11Y-004 | Touch targets at least 24 by 24 CSS pixels (WCAG 2.2), with 44 by 44 as the design default. |

### Security

| ID | Requirement |
|---|---|
| REQ-NFR-SEC-001 | Tenant isolation enforced in one data access layer. Cross-tenant tests in CI. See [../architecture/multi-tenancy.md](../architecture/multi-tenancy.md). |
| REQ-NFR-SEC-002 | No card data stored. Stripe secrets encrypted at rest. Webhook signatures verified. |
| REQ-NFR-SEC-003 | Rate limiting on auth, posting, invitations, and (from Phase 6) API tokens. |
| REQ-NFR-SEC-004 | Content Security Policy, secure cookies, CSRF protection on mutations. |
| REQ-NFR-SEC-005 | Uploaded files scanned for type, size limited, and served from a separate origin or with safe content headers. |
| REQ-NFR-SEC-006 | Dependency and secret scanning in CI. Security policy and disclosure process published. |

### Privacy

| ID | Requirement |
|---|---|
| REQ-NFR-PRIV-001 | No third-party trackers in member routes by default. |
| REQ-NFR-PRIV-002 | Members' data export and deletion (see REQ-ID-007). |
| REQ-NFR-PRIV-003 | Cloud Edition data location stated publicly. **Open question** which regions. |
| REQ-NFR-PRIV-004 | Data processing roles documented: creator as controller for their community, cloud operator as processor. **Assumption**, needs legal review. |

### Self-hosting footprint

**Recommendation.** The Community Edition runs on a 2 vCPU, 4 GB RAM VPS with Docker Compose.

| ID | Requirement |
|---|---|
| REQ-NFR-HOST-001 | Services: web, worker, PostgreSQL, and a one-shot migrations container. Jobs run on PostgreSQL (pg-boss) by default. Redis (BullMQ) and S3-compatible storage are optional Compose profiles (local disk adapter as the storage fallback). See [../decisions/0005-postgres-job-queue.md](../decisions/0005-postgres-job-queue.md). |
| REQ-NFR-HOST-002 | Indicative memory budget: web 1 GB, worker 512 MB, PostgreSQL 1 GB, remainder for the OS and optional services (Redis about 256 MB if enabled, storage). |
| REQ-NFR-HOST-003 | Install from a clean VPS to a working community in under 30 minutes by following the README. |
| REQ-NFR-HOST-004 | Documented backup, restore, and upgrade. Migrations run automatically and are forward only. |
| REQ-NFR-HOST-005 | No outbound calls to Cohory services. Optional integrations (Stripe, SMTP, OAuth) configured by the operator. |

### Observability

| ID | Requirement |
|---|---|
| REQ-NFR-OBS-001 | Structured JSON logs with request ID and community ID, without personal data in log messages. |
| REQ-NFR-OBS-002 | Health and readiness endpoints for web and worker. |
| REQ-NFR-OBS-003 | OpenTelemetry traces and metrics, off by default on the Community Edition. |
| REQ-NFR-OBS-004 | Job queue visibility: failed jobs listed with retry. |
| REQ-NFR-OBS-005 | Alerts on fee ledger reconciliation mismatches (Cloud). |

### Internationalization readiness

| ID | Requirement |
|---|---|
| REQ-NFR-I18N-001 | All UI strings in message catalogs from day one. English only at MVP launch. |
| REQ-NFR-I18N-002 | Dates, times, numbers, and currency formatted by locale. Times stored in UTC. |
| REQ-NFR-I18N-003 | Layouts tolerate 30% longer strings and right-to-left direction (tested, not shipped, in MVP). |
| REQ-NFR-I18N-004 | Member content is stored as entered. No machine translation in MVP. |

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | MVP scope per the brief, four member tabs, the Manage sections in REQ-COM-005, 2% Cloud platform fee, 0% on Community Edition. |
| Confirmed | Migration is its own Manage section (founder, 2026-10-19). This replaces the earlier recommendation to keep it inside Settings. |
| Confirmed | Custom domains (REQ-COM-007) are Post-MVP (founder, 2026-10-25). Nothing is built for them in 0.12.0. |
| Recommendation | Stripe Connect (Accounts v2 connected accounts with full dashboard access) with direct charges. |
| Recommendation | Past due keeps access in MVP. Configurable grace period Post-MVP. |
| Recommendation | No video transcoding in MVP. |
| Recommendation | Reference self-hosting footprint 2 vCPU, 4 GB RAM, with the load target in REQ-NFR-PERF-005. |
| Recommendation | Two-factor authentication Post-MVP, then required for owners with a connected payment account. |
| Assumption | Data processing roles (creator as controller). Needs legal review. |
| Open question | Cloud Edition hosting regions. |
| Open question | Default level thresholds for gamification. |
| Open question | Is one-time course purchase needed in MVP for the primary persona, or is it safe as Post-MVP? |
