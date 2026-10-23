# Principles

The ten rules we use to make product and engineering trade-offs, with concrete consequences for each.

**Confirmed.** The ten principles below come from the founder brief. The examples, exclusions, and tensions are **Recommendation** unless marked otherwise. When two principles conflict, the tension notes say which one usually wins and why. A decision that overrides a principle needs a decision record in [../decisions/README.md](../decisions/README.md).

## How to use this document

When reviewing a feature, a pull request, or a design, ask for each relevant principle: does this change follow the "influences" examples, and does it fall into anything listed under "rules out"? If it does, the burden of proof is on the change.

## 1. Simplicity over feature quantity

**Statement.** A smaller product that a creator understands in one sitting beats a larger product they have to learn.

**Why it matters.** The primary audience runs a business, not a software project. Every extra setting, tab, or concept is something they must decide about, explain to members, or ignore with mild guilt. Simplicity is also our main defense against becoming another Circle or Kajabi feature checklist.

**How it influences decisions.**
- Members see exactly four tabs: Community, Classroom, Calendar, Members. New features go inside one of them or into the API.
- Each screen has one obvious primary action (for example, "Write a post" in Community, "Continue" in Classroom).
- A post can be created in one or two interactions from the feed.
- Gamification ships with one points rule (likes received) and a fixed set of levels in MVP, not a rules engine.
- Events support one-off and simple recurring schedules, not arbitrary recurrence rules, in MVP.

**What it rules out.** A fifth member tab. Per-member customizable dashboards. Feature flags exposed to creators as a long settings page. Shipping two ways to do the same thing.

**Tensions.** With Principle 4 (API-first) and the developer audience, who want more knobs. Resolution: knobs go in the API, configuration files, or plugins, not in the creator UI. With Principle 8 (agents), which can tempt us to add agent panels to the UI. Resolution: agent features appear as ordinary results (a draft post, a scheduled event) rather than new surfaces.

## 2. Ownership over lock-in

**Statement.** Creators own their members, content, data, payment account, subscriptions, and hosting choice. We earn retention by being good, not by being hard to leave.

**Why it matters.** This is the main differentiator. On many hosted platforms, recurring revenue sits in the platform's payment account, so leaving means asking every subscriber to pay again. We want the opposite to be true and verifiable.

**How it influences decisions.**
- Stripe Connect uses direct charges on the creator's connected account, so subscription objects live in the creator's Stripe account. **Recommendation.** Use connected accounts with full Dashboard access, with Stripe as the processing fee and loss collector (the Accounts v2 configuration in [../architecture/payments.md](../architecture/payments.md)), so the creator can keep using that account without us. The legacy Standard account type is deprecated for new platforms.
- A full community export is available from Settings at all times, including on free Cloud communities.
- Offboarding from the Cloud Edition removes the application fee from future invoices of active subscriptions. We do not keep collecting fees after the creator leaves.
- Custom domains are creator-controlled DNS. If the creator moves to self-hosting, they repoint DNS and members keep the same URL.
- Member email addresses are visible and exportable by the creator (subject to the privacy rules in Principle 7).

**What it rules out.** Holding subscriptions in a cohory-owned Stripe account. Export features that are paywalled, rate limited to the point of uselessness, or delayed by manual approval. Proprietary content formats that cannot be read without our software.

**Tensions.** With Principle 7 (privacy): ownership of member data by creators must still respect members' rights to deletion and limited use. Resolution: creators own the business relationship, members keep their legal rights, and exports respect deletions. With the business model: easy exit reduces switching costs away from us. Resolution: accepted on purpose. It is the product promise.

## 3. Open standards over proprietary formats

**Statement.** When a standard exists for data, identity, content, or integration, we use it instead of inventing our own.

**Why it matters.** Standards make exports useful, integrations cheap, and self-hosting realistic. A creator who leaves should be able to read their data with ordinary tools.

**How it influences decisions.**
- API described with OpenAPI 3.1 and served at a stable path (planned `/api/openapi.json`).
- Rich text stored as a documented JSON document model with a Markdown export. Lesson content exports as Markdown with front matter.
- Events export as iCalendar (`.ics`), and each member gets a personal calendar feed URL.
- Member exports in CSV and JSON. Community export as a versioned JSON bundle plus media files in a ZIP.
- Authentication supports OAuth 2.0 and OpenID Connect providers. Agent integration uses MCP (post-MVP) rather than a custom protocol.
- Object storage uses the S3 API so any compatible store works.

**What it rules out.** Custom binary export formats. A custom agent protocol when MCP fits. Storing lesson content as HTML blobs with inline styles that cannot be converted.

**Tensions.** With Principle 1: some standards are complex (full iCalendar recurrence, SCORM). Resolution: support the standard as an export or interchange format, and keep the UI to a simple subset. We do not plan SCORM in MVP. With Principle 10: generic formats can be slower to render. Resolution: store in a standard format and cache rendered output.

## 4. API-first architecture

**Statement.** Every capability exists as a documented API before or at the same time as it appears in the UI.

**Why it matters.** It keeps the web app honest, makes agents possible without special back doors, and lets developers and agencies build on the platform (the "WordPress for Communities" direction in [business-model.md](business-model.md)).

**How it influences decisions.**
- Domain logic lives in modules with typed service functions. Next.js route handlers and server actions are thin callers of those services, as are the REST API and, later, MCP tools. See [../architecture/overview.md](../architecture/overview.md).
- A feature is not done until its OpenAPI operation, authorization rule, and tests exist.
- Webhooks are emitted for key domain events (member joined, membership changed, post published, lesson completed). **Recommendation.** Post-MVP for outbound webhooks, but the internal event names are fixed in MVP.
- API tokens are scoped per community and per permission, never global.

**What it rules out.** UI-only features implemented in client components that call the database through hidden paths. Undocumented internal endpoints that the official UI depends on but third parties cannot use. A separate "agent API" with different authorization from the human API.

**Tensions.** With Principle 1: a full API surface invites complexity. Resolution: the API mirrors the UI's concepts and does not add concepts the UI lacks. With Principle 10: a strict API layer can add latency. Resolution: server components call module services directly in process, while external clients use HTTP. Both go through the same authorization.

## 5. Excellent defaults over excessive configuration

**Statement.** The right choice should already be made. Configuration exists for real differences between communities, not for our indecision.

**Why it matters.** Creators judge the product in the first ten minutes. A good default is a decision made once by us instead of thousands of times by creators.

**How it influences decisions.**
- A new community starts with sensible categories (General, Introductions, Announcements), a suggested introduction post, and the default level names.
- Appearance customization is limited to accent color, logo, cover image, three curated fonts, card style (Soft or Minimal), and Light, Dark, or System.
- Notification defaults are conservative: email only for replies and mentions, batched every 15 minutes. A daily digest is Post-MVP.
- Membership setup offers free or one paid plan (monthly with an optional annual price) in MVP. More tiers are Post-MVP.
- Self-hosting ships with one `docker-compose.yml` and an `.env.example` where every variable has a working default except secrets.

**What it rules out.** Custom CSS editors in MVP. Per-feature on and off switches for every module. Asking the creator to choose a time zone before they can create a community (we detect it).

**Tensions.** With Principle 2 and 9: developers and self-hosters may need to change defaults. Resolution: environment variables and the API for operators, plain settings for creators. With Principle 6: some accessibility needs require user-level preferences (reduced motion, text size). Resolution: member-level accessibility preferences are allowed and respected even though they add settings.

## 6. Accessibility by default

**Statement.** Every member and creator screen meets WCAG 2.2 AA from the first release, and accessibility is tested, not assumed.

**Why it matters.** Communities include people using screen readers, keyboards, magnification, and low-bandwidth devices. Retrofitting accessibility is far more expensive than building with it. Radix and shadcn/ui give us a good base, but only if we do not break them.

**How it influences decisions.**
- Color tokens are checked for contrast in both light and dark modes. Creator accent colors are validated, and if a chosen accent fails contrast on buttons, we adjust the shade used for text on it automatically. See [../brand/design-tokens.md](../brand/design-tokens.md).
- Every interactive component has visible focus states and full keyboard operation. The lesson player supports captions and keyboard controls.
- Automated accessibility checks (axe or equivalent) run in CI on key pages. A manual screen reader pass is part of each phase's acceptance criteria.
- Motion respects `prefers-reduced-motion`. No essential information is conveyed only through animation or color.
- Uploaded images in posts prompt for alt text (optional but encouraged), and lesson videos accept caption files.

**What it rules out.** Custom dropdowns, dialogs, or menus that replace Radix primitives without equal accessibility. Accent colors that make primary buttons unreadable. Icon-only buttons without accessible labels.

**Tensions.** With creator customization (Principle 5): free color choice can break contrast. Resolution: validate and adjust automatically, and explain why in plain language. With Principle 10: some accessible patterns add markup or work. Resolution: accessibility wins.

## 7. Privacy and security by design

**Statement.** We collect the minimum data needed, isolate tenants strictly, and treat money, identity, and permissions as the highest risk areas in the codebase.

**Why it matters.** We hold members' personal data and touch creators' revenue. A cross-tenant data leak or a payment bug would destroy the trust the product depends on.

**How it influences decisions.**
- Every query on tenant data is scoped by community ID through a single enforced path. Authorization rules are defined in [../architecture/authorization.md](../architecture/authorization.md) and isolation in [../architecture/multi-tenancy.md](../architecture/multi-tenancy.md).
- We never store card data. Payment details stay with the provider.
- No third-party analytics or tracking scripts in the member experience by default. Self-hosters can add their own.
- Tests are required for financial calculations, authentication, permissions, and subscription logic before merge.
- Members can export and delete their own personal data. Deletion removes or anonymizes personal data across communities while preserving the creator's financial records where law requires.

**What it rules out.** Global admin backdoors that bypass tenant checks. Selling or sharing member data. Email open tracking pixels by default. Agent tokens with wildcard scopes.

**Tensions.** With Principle 2 (ownership): creators want full member data. Resolution: creators get the data needed to run their business (name, email, membership, activity in their community), not members' activity in other communities. With Principle 8: agents need data access to be useful. Resolution: scoped, audited, revocable tokens with human approval for sensitive actions.

## 8. Agent compatibility without sacrificing human UX

**Statement.** Agents can do what humans can do through the same API and permissions, but the human interface is never bent to suit agents.

**Why it matters.** Agents are part of the long-term vision (creator automation and agent-ready courses). Bolting them on later usually produces unsafe shortcuts. Designing for them early, while keeping the UI human, avoids both problems.

**How it influences decisions.**
- Agents are a distinct actor type with their own identity, owner, scopes, and audit trail. They are not shared user accounts.
- Financial and admin actions by agents (refunds, price changes, role changes, removals) require human approval by default. Agents never get payout or account ownership permissions.
- Course content has structure (modules, lessons, resources, exercises) that can later be serialized for agents without rewriting courses.
- External content an agent fetches, including downloaded skills or course material from another community, is treated as untrusted input and never executed with elevated permissions.
- Agent-generated content is labeled as such in the UI where it is published on behalf of a person.

**What it rules out.** "AI" buttons scattered across the member UI. Agent access through scraped sessions or shared passwords. Skipping the approval step for money because an agent is "trusted".

**Tensions.** With Principle 1: approvals and audit logs add creator-facing surface. Resolution: approvals appear as a single queue in Manage, Overview, only when an agent is connected. With Principle 10: approval steps slow down automation. Resolution: creators can pre-approve narrow, low-risk actions (for example "publish drafts in Announcements"), never money.

## 9. Self-hosting must remain genuinely useful

**Statement.** The Community Edition is a complete product, not a demo for the cloud. It runs on modest hardware with documented operations.

**Why it matters.** Self-hosting is both an ethical commitment (ownership) and our distribution strategy (open-source adoption). A crippled self-hosted edition would break trust with the developers and creators we most need early.

**How it influences decisions.**
- Every MVP feature runs on the Community Edition with no call to a cohory-operated service.
- **Recommendation.** The reference deployment is Docker Compose on a 2 vCPU, 4 GB RAM VPS: web app, worker, PostgreSQL, and a one-shot migrations container, with Redis and S3-compatible storage as optional profiles. Jobs run on PostgreSQL by default. See [product-requirements.md](product-requirements.md).
- Upgrades are a documented `docker compose pull` plus automatic migrations, with a backup step first.
- Features that need heavy infrastructure (video transcoding, large-scale search) are optional and pluggable, with a working fallback (external video embeds, PostgreSQL full-text search).
- Cloud-only code is limited to operations: billing of the platform fee, tenant provisioning, custom domain automation, and managed backups.

**What it rules out.** Requiring Kubernetes, Elasticsearch, or a separate microservice for core features. License checks or phone-home telemetry in the Community Edition. Core features hidden behind a cloud flag.

**Tensions.** With the business model: a strong free edition competes with the Cloud Edition. Resolution: the Cloud Edition sells convenience (managed hosting, updates, backups, domains, payment setup), not features. With Principle 10: a small server limits performance at scale. Resolution: publish tested capacity numbers so operators know when to scale.

## 10. Fast, responsive, predictable interfaces

**Statement.** Pages load quickly on ordinary phones, actions respond immediately, and the interface behaves the same way everywhere.

**Why it matters.** Community products are habits. Slow feeds and unpredictable layouts reduce return visits. Predictability also matters for accessibility and for members who belong to several communities.

**How it influences decisions.**
- Performance budgets are requirements, not goals (see the non-functional section of [product-requirements.md](product-requirements.md)).
- Liking, commenting, and RSVP use optimistic updates with clear rollback on failure.
- Layout and navigation are identical across communities. Creators change accent, logo, font, and card style, not structure.
- Feeds paginate with cursors, and images are served in responsive sizes from object storage.
- Lists that can grow (members, posts, comments) are designed for 10,000 items from the start.

**What it rules out.** Heavy client-side animation libraries in member routes. Layouts that shift as content loads. Per-community layout builders. Blocking full-page reloads for simple actions.

**Tensions.** With Principle 4: strict layering can slow responses. Resolution: in-process service calls for server rendering. With Principle 5: rich customization would make interfaces unpredictable. Resolution: customization stays within the curated options.

## Additional principle (Recommendation)

### 11. Honest money

**Recommendation.** We add one principle because the brief makes payments a core differentiator and the existing ten do not cover financial transparency directly.

**Statement.** Every fee, charge, and payout is visible, explainable, and reproducible from records.

**Why it matters.** The business model depends on a 2% fee. Creators will trust it only if they can see exactly how each fee was calculated and why it was charged or refunded.

**How it influences decisions.**
- Every platform fee is written to an append-only fee ledger with the transaction ID, fee base, rate, rounding, and resulting amount (see [business-model.md](business-model.md)).
- The Payments section shows the fee for each transaction in plain language ("Platform fee: 2%").
- Fee calculations live in one tested module with property-based tests for rounding and refunds.
- Processing fees are always shown as separate from the platform fee.

**What it rules out.** Hidden fees, minimum monthly charges presented as "fees", silent rate changes, or fee logic duplicated in several places.

**Tensions.** With Principle 1: detailed financial records add screens. Resolution: show a simple total by default, with details one click away.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Principles 1 to 10 as listed in the brief. |
| Recommendation | Principle 11, "Honest money", covering fee transparency and the fee ledger. |
| Recommendation | Knobs for developers go in the API, environment variables, or plugins, never in the creator UI. |
| Recommendation | Agent approvals live in a single queue under Manage, Overview, shown only when an agent is connected. |
| Recommendation | Accent colors are validated and automatically adjusted for contrast. |
| Recommendation | Reference self-hosting footprint is 2 vCPU and 4 GB RAM with Docker Compose. |
| Open question | Should creators be able to pre-approve any agent action category beyond publishing drafts? Proposed default: only content actions, never money, roles, or removals. |
| Open question | Is optional, opt-in anonymous usage telemetry acceptable in the Community Edition? Proposed default: no telemetry at all in MVP. |
