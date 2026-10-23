# MVP scope

The smallest useful version of Cohory: what is in, what is out, and how a release manager verifies it.

Feature details per module are in [feature-inventory.md](feature-inventory.md). Screens are in [information-architecture.md](information-architecture.md). Flows are in [user-journeys.md](user-journeys.md). Phase definitions are in [../foundation/roadmap.md](../foundation/roadmap.md).

## 1. Definition

**Recommendation:** the MVP is the first release a creator can use to run a real paid community, on Cloud or self-hosted, without help from the team. It completes roadmap phases 1 to 4. Migration (phase 5) and agent integrations (phases 6 and 7) come after.

The MVP must prove three things:

1. A creator can launch a community and get paid into their own Stripe account.
2. Members can post, learn, and attend events in an interface as simple as the four tabs promise.
3. The same product runs self-hosted with Docker Compose and on Cloud.

## 2. In scope

**Confirmed:** auth, community creation, member management, posts and comments, basic courses, basic events, simple gamification, Stripe Connect payments, paid memberships, responsive UI, Docker self-hosting.

Boundaries below are **Recommendation** unless marked otherwise.

### 2.1 Authentication

- In: email and password with verification, magic link sign in, password reset, sign out everywhere, account deletion.
- In: one platform profile (name, username, avatar, bio, up to 3 links).
- Out: social login, two-factor authentication, SSO.
- Built in 0.3.0: sign out everywhere and the active sessions list on Account, Security, and account deletion with a 14 day grace period.
- Built in 0.11.0 ([0038](../decisions/0038-email-verification-required.md)): when the server sends email, a confirmed email is required before the first password sign in, with "Send a new link" on sign in and a `/verified` page after the link; magic link sign in ("Email me a sign in link", 15 minutes, single use, existing accounts only); changing the email address on Account, Security, approved from the current address first; and a "password changed" email. A password chosen before the email was confirmed is removed the first time the account signs in with a magic link, unless a password reset came first. Without a mail server (`EMAIL_DRIVER=log`) verification stays off and magic link and change email are not offered.

### 2.2 Community creation

- In: three-step wizard (name and slug, free or paid, logo and accent). Defaults make the community usable immediately.
- In: About page, private (default) or public read-only feed preview, join modes (open, approval required, invite link), up to 3 join questions.
- In: transfer ownership, delete community (14-day soft delete).
- In: custom domain mapped to the community root (Cloud and self-hosted).
- Out: community directory, templates, multiple languages per community.

### 2.3 Member management

- In: roles owner, admin, moderator, member. Guest as non-member state.
- In: member directory and profiles, pending requests, invite link, remove, ban, reports queue, members CSV export (owner only, includes Stripe customer and subscription IDs).
- In: admin audit log (role changes, bans, exports, payment settings).
- Built in 0.3.0: the reports queue (Manage, People, Reports; Manage, Inbox, Reports since 0.11.0) for posts and comments with dismiss, delete, and ban; the audit log screen in Manage, Settings with action and date filters and an owner only CSV download; the community switcher in the platform header.
- Out: email invites in bulk, member tags, online indicator, custom roles.

### 2.4 Posts and comments

- In: posts with optional title, sanitized rich text body (bold, italic, lists, links, quotes, code), up to 10 images (10 MB each), video embeds from YouTube, Vimeo, Loom, Wistia, auto-linked URLs, mentions.
- In: up to 10 categories, up to 3 pinned posts, likes on posts and comments, edit with "Edited" label, delete, report, follow.
- In: comments with one reply level, mentions, likes.
- In: feed sorted by latest activity (default), new, or top (likes plus comments over the last 7 days, a visible count). No personalized ranking.
- In: "Email to all members" on a post, owner and admins, once per 24 hours per community.
- Out: polls, file attachments on posts, link preview cards, scheduled posts, reactions other than like, images in comments, post drafts saved on the server.

### 2.5 Basic courses

- In: courses with title, description, cover. Modules and lessons, draft and published states, drag and drop ordering.
- In: lessons with video by URL (same allowlist as posts), markdown body, up to 10 attachments of 25 MB each, mark complete, next and previous, collapsible sidebar.
- In: progress per member per course, a "Continue" chip with the lesson and progress on the feed.
- In: course access is "all members", optionally locked until a level ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)). Members below it see the course locked, without its lessons; moderators, admins and the owner always open it. The lock applies only while levels are on.
- Out: video upload and hosting, quizzes, drip, certificates, tier unlocks, lesson level unlocks, one-time course purchases, lesson comments, version history.

### 2.6 Basic events

- In: single events and weekly recurring series with optional end date (**Recommendation**, decided here: weekly only, because a weekly community call is the common case and other patterns multiply time zone edge cases).
- In: cancel one occurrence, edit the whole series, occurrences generated 12 weeks ahead.
- In: location as meeting URL or text, month and list views, viewer's local time, RSVP (going or not going), reminder email one hour before for RSVP'd members, .ics download.
- Out: daily or monthly recurrence, per-occurrence edits other than cancel, calendar feed subscription, paid events, built-in video.

### 2.7 Simple gamification

- In: 1 point per like received on a post or comment. No points for posting. No self-likes. Unlike or deletion removes the point.
- In: 9 levels with fixed thresholds. Creators can rename levels, not change thresholds.
- In: leaderboards for a rolling 7 days and all time, level badge on avatars, admin reset of one member's points.
- Built in 0.3.0: an owner or admin resets every member's points at once from Manage, Settings, with the history kept. Resetting one member is not built.

| Level | Points needed | Default name |
|---|---|---|
| 1 | 0 | Newcomer |
| 2 | 10 | Member |
| 3 | 30 | Regular |
| 4 | 75 | Contributor |
| 5 | 150 | Helper |
| 6 | 300 | Guide |
| 7 | 600 | Mentor |
| 8 | 1,200 | Leader |
| 9 | 2,500 | Legend |

- Built, off by default ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)): points for learning, 1 point per finished lesson and per attended event (a going RSVP on an occurrence that ended and was not cancelled), each counted once, awarded by a worker job within about 15 minutes. It is off in every community until an owner or admin turns on Each lesson a member finishes or Each event a member attends in Manage, Settings, Points.
- In: the leaderboard shows the viewer's progress to the next level, how points are earned, and the nine levels with the share of members at each.
- Out: custom rules, badges, 30-day leaderboard, other point values.

**Open question:** whether the thresholds feel right. They are a starting point to tune with real communities.

### 2.8 Stripe Connect payments

- In (Cloud): "Connect your Stripe account" through Stripe Connect onboarding. Direct charges on the connected account. Application fee of 2% on successful transactions, shown as "Platform fee: 2%" ([ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md)). Processing fees are separate and charged by Stripe.
- In (self-hosted): the creator's own Stripe API keys, no platform fee.
- In: Stripe Checkout, idempotent webhook processing with reconciliation, fee ledger records for every Cloud application fee, recent payments list in Manage.
- Out: Bring Your Own Payment Provider, periodic platform billing, coupons, payouts UI (the creator uses the Stripe dashboard).

See [../architecture/payments.md](../architecture/payments.md) for charge flow and fee rules.

### 2.9 Paid memberships

- In: a community is free or paid. Paid has one plan with a monthly price, an optional annual price, one currency.
- In: subscriptions created on the creator's Stripe account, community entitlement derived from subscription status, cancel at period end via the Stripe customer portal, past due keeps access, canceled or unpaid removes it, comped access granted by the owner.
- Built in 0.11.0 ([0040](../decisions/0040-fair-cancel-and-pause.md)): the price on the membership status, "Membership and billing" in the community menu and Billing in the account menu, one cancel screen with switch to yearly, pause payments for 1 to 3 months, and cancel side by side, a yearly suggestion after two paid months, a yearly choice on the join button, branded Checkout, invite holds that expire after 24 hours, and a renewal reminder email 7 days before a yearly renewal.
- Built in 0.3.0: comped access, granted by the owner or an admin by email with an optional end date, revocable, and ended by an hourly job; erasing an account cancels its paid subscriptions and deletes its Stripe customers.
- In: price changes apply to new members only.
- Built in 0.11.0 (safe exit, [ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md)): archiving asks whether paying members stop at period end or keep billing; disconnecting removes the Cohory fee from every subscription before the connection closes and asks whether members go with the creator or wind down; deleting an archived community cancels its subscriptions immediately without proration first; an ownership transfer pauses new checkouts until the new owner chooses a Stripe account; account deletion waits while an owned community still bills; members get an in-app notice and an email, and Account, Billing lists every paid membership. Resume renewals is not built.
- Out: multiple tiers, free trials, one-time purchases, importing existing subscriptions.

### 2.10 Responsive UI

- In: every screen works at 375 px width and up. Bottom navigation with the four tabs on mobile. Light, dark, and system modes.
- In: appearance settings (accent color with contrast check, logo, cover, 3 fonts, Soft or Minimal cards).
- In: WCAG 2.2 AA as the target for color contrast, keyboard navigation, focus states, and screen reader labels on all MVP screens.
- Out: native apps, offline mode, web push.

See [../brand/design-tokens.md](../brand/design-tokens.md).

### 2.11 Docker self-hosting

- In: one `docker compose up` brings up the web app, the worker, PostgreSQL, and a one-shot migrations container that runs before web and worker start. Background jobs run on PostgreSQL (pg-boss) by default. Redis (for BullMQ) and an S3-compatible store are optional profiles, with local disk storage as the default ([../decisions/0005-postgres-job-queue.md](../decisions/0005-postgres-job-queue.md)). Documented environment variables.
- In: instance settings for email (SMTP), storage, signups open or closed, default community.
- In: documented backup and restore of PostgreSQL and storage. Documented upgrade path between versions.
- Out: Kubernetes manifests, one-click installers for hosting providers, automatic updates for self-hosted.

### 2.12 Supporting items included in MVP

- In-app notifications and batched email, per-community preferences.
- Built in 0.3.0: email for mentions, replies, and comments on your posts, right away or in a daily summary, with preferences per type that apply to every community. Per community preferences are not built. Join requests notify the team, and the answer notifies the person who asked.
- In (founder, 2026-10-22, [0034](../decisions/0034-notification-types-and-weekly-digest.md)): a weekly digest email on Monday at the member's digest hour, on by default, combining every community with at least 2 new posts that week (top posts, new members, next events, course progress), with a one click off. Built in 0.11.0, together with notices for new members, likes, reports, and money events, failed payment emails to the member, and the ownership transfer email.
- In: one welcome email per membership, sent 2 minutes after activation, with the creator's name and links to the feed, the first course, and the next event. Built in 0.11.0.
- Community-scoped search over posts, comments, members, and lesson titles and bodies (PostgreSQL full-text).
- Migration section in Settings that explains options and links to members CSV export. No importers.

## 3. Out of scope

**Confirmed (deferred in the brief):** full AI course generation, hosted agent execution, agent marketplace, complex automation builders, advanced analytics, native mobile apps, large plugin marketplace.

Also out of MVP:
- Bring Your Own Payment Provider and ledger billing (Post-MVP).
- Direct messaging (founder priority Later).
- Migration importers and full archive export and import (Phase 5).
- REST API v1 with tokens, MCP server, agent identities (Phase 6).
- Agent-ready courses (Phase 7).
- Everything in the "Out" lines of section 2.

## 4. MVP acceptance criteria

A release manager checks each item on a fresh Cloud environment and a fresh self-hosted install unless noted.

For 0.1.0, the ticked items passed in the release verification runs on a self-hosted Compose install, including the Playwright suite in `apps/e2e` (journeys 1, 3, 5 to 9, 11, and the payments journeys against a fake Stripe server). The release manager still rechecks every item. The 0.3.0 release verification added Playwright journeys for approval join mode with join questions, categories, feed sort, search, reports, the audit log screen, points reset, comped access, notification preferences, sessions, and account deletion; those passed on the same kind of install. The unticked ones are built but not yet in a release verification run ("Email to all members", slug suggestions, magic link sign in), were not checked end to end (level changes at the thresholds), or need a run against real Stripe test mode, which no release verification run had.

Identity and communities:
- [ ] A new person signs up, verifies email, and signs in with password and with magic link.
- [x] A creator creates a community with only a name and slug, and lands on its feed.
- [ ] Slug conflicts are rejected with suggestions.
- [ ] Private community shows only the About page to guests. Public shows About plus read-only feed.
- [x] Open join, approval required, and invite link each work end to end (approval with join questions, a decline with a note, a second request, and invite links that need approval pass in the 0.3.0 suite).
- [ ] Ownership transfer and community deletion work and are recorded in the audit log.

Members:
- [x] Owner changes a member to admin and to moderator. Each role sees only what [../architecture/authorization.md](../architecture/authorization.md) allows.
- [x] A user in community A cannot read or change any data in community B through the UI or by editing URLs or request bodies.
- [x] Remove and ban work. A banned person cannot rejoin.
- [x] Members CSV export downloads with the documented columns.

Community:
- [ ] A member creates a post in one or two interactions (tap composer, tap Post) on desktop and on a 375 px screen.
- [x] Images, video embeds, mentions, categories, pins, likes, comments, and replies work (categories, chips, sort, and pinned ordering pass in the 0.3.0 suite).
- [x] Disallowed HTML and scripts in posts and comments are stripped.
- [ ] "Email to all members" sends once and is blocked a second time within 24 hours.

Classroom:
- [x] Admin creates a course with a module and a lesson inside Classroom, without visiting Manage.
- [x] Draft courses and lessons are invisible to members.
- [x] A member marks lessons complete and the progress bar updates.
- [x] The feed shows "Continue learning" for an in-progress course, and one tap opens the right lesson.

Calendar:
- [x] Admin creates a single event and a weekly series inside Calendar.
- [x] A member in another time zone sees correct local times, including across a daylight saving change.
- [x] RSVP works, the reminder email arrives one hour before start, and the .ics file imports into a common calendar app.

Gamification:
- [x] Likes add points, unlikes remove them, self-likes are impossible.
- [ ] Levels change at the documented thresholds. Renamed levels display everywhere.
- [x] 7-day and all-time leaderboards match the recorded point events.

Payments and memberships (Stripe test mode):
- [ ] Owner connects Stripe through "Connect your Stripe account" (Cloud) or API keys (self-hosted).
- [ ] A guest pays through Stripe Checkout and reaches the feed without manual steps.
- [ ] The subscription and customer exist in the creator's Stripe account.
- [ ] Cloud charges carry a 2% application fee and a matching fee ledger entry. Self-hosted charges carry no application fee.
- [x] Platform fee calculation, rounding, and entitlement logic have automated tests.
- [ ] Replaying a webhook does not create duplicate records.
- [ ] Cancel at period end, past due, and canceled states each produce the documented access.

UI and accessibility:
- [ ] Every MVP screen has one filled primary button at most (checked against the table in [information-architecture.md](information-architecture.md)).
- [x] Bottom navigation shows the four tabs on mobile. No fifth tab exists.
- [ ] Light and dark modes pass contrast checks. All flows above work with keyboard only.
- [ ] Creator-facing labels use plain language ("Connect your Stripe account", "Platform fee: 2%").

Self-hosting:
- [ ] `docker compose up` on a clean Linux host with documented environment variables produces a working instance (passes on macOS with Docker Desktop; a clean Linux host is still to be checked).
- [ ] Backup and restore of database and storage follow the documented steps and lose no data.
- [x] Upgrading from the previous release candidate runs migrations without manual steps (`scripts/upgrade-check.sh` from migration 0004).

## 5. Post-MVP

Planned next, roughly in roadmap order:

- Full archive export and import, Cloud to self-hosted move (Phase 5, built in 0.4.0).
- "Bring your existing subscribers" from creator-owned Stripe accounts, Skool and Circle importers, generic CSV importer (Phase 5; subscriber linking, the Skool and Circle importers, and member CSV import built in 0.4.0; linking is Community Edition only and every edition moves paying members with free time since [0042](../decisions/0042-moving-paying-members.md)).
- Public REST API v1 with OpenAPI, scoped tokens, MCP server, agent identities, audit log for agent actions, human approval workflow (Phase 6; scoped tokens, agent identities, the audit log for agent actions, the approval workflow, outbound webhooks, scheduled posts, and the typed SDK built in 0.6.0; the MCP server with OAuth sign in built in 0.7.0).
- Bring Your Own Payment Provider with fee ledger billing (Phase 5, built in 0.5.0 for Polar; a live Polar sandbox run is still a human gate).
- Multiple membership tiers, free trials, coupons, course access by tier (course access by level is built, [0045](../decisions/0045-levels-that-unlock-and-learning-points.md)).
- Member reviews on the About page from members who have paid for at least 30 days, with owner replies and owner hiding of reported reviews (Phase 3 follow-up, built in Step 17, 0.10.0).
- Direct messaging, behind a top bar icon, not a tab.
- Polls, link previews, attachments on posts, lesson comments, quizzes, drip.
- Social login, two-factor authentication.
- Web push, calendar feed subscription. (The daily summary and the weekly digest are MVP and built.)

## 6. Long-term vision

Direction, not commitments:

- Agent-ready courses: structured lessons, references, executable tasks, automated evaluations, SKILL.md generation, verified capability reports (Phase 7; built in 0.8.0 except verified capability reports, since results are self reported and hosted execution is out of scope).
- Delegated agent access to purchased courses with owner approval (Phase 7, built in 0.8.0: members give their own agents read access to a course; agents propose purchases that only their person approves and pays).
- Plugin SDK and a curated plugin and theme ecosystem.
- Native mobile apps.
- Advanced analytics and automation, kept inside Manage.
- White-label and embeddable components for developers and agencies.

## 7. MVP success signals (hypotheses)

These are hypotheses to test after launch. None is validated. Numbers are starting targets to revise, not promises.

| Hypothesis | Signal we would look for |
|---|---|
| Creators can launch without help | Most new communities reach a first post within one day of creation |
| Creator-owned billing matters enough to switch | Paid communities connect Stripe within a week of creation |
| The four-tab layout is enough | Few support requests ask "where is X" for member features |
| Gamification drives participation | Communities where members receive likes show more returning posters |
| Resume card helps learning | Lesson starts from the feed card are a meaningful share of all lesson starts |
| Self-hosting is genuinely usable | Self-hosters complete installation from the docs without opening an issue |
| The 2% fee is acceptable | Creators do not cite the fee as a reason to leave Cloud |

**Assumption:** we will measure these with privacy-respecting, aggregate product metrics on Cloud and opt-in telemetry (or none) on self-hosted.

## 8. Key risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Stripe Connect constraints | Direct charges, application fees on subscriptions, and account types vary by country. Wrong choices block portability later. | Prototype the charge flow in phase 3 first. Document limits in [../architecture/payments.md](../architecture/payments.md). |
| Scope creep from Skool parity | Every missing feature looks small. Together they delay launch. | This document is the boundary. Additions need a written reason and something removed. |
| Tenant isolation bugs | One leak between communities breaks trust. | Tenant checks in the service layer, automated cross-tenant tests in acceptance criteria. |
| Webhook and entitlement drift | Members paying without access, or with access without paying. | Idempotent handlers, periodic reconciliation job, tests on state transitions. |
| Self-hosting support load | Many environments, many failure modes. | One supported path (Docker Compose), clear docs, small set of required services. |
| Spam and abuse on Cloud | Open signup invites abuse. | Rate limits, verified email for payments, reports queue, ban. |
| Video embeds only | Some creators expect upload. | Clear messaging. Upload is Post-MVP once storage costs are understood. |
| Fee rules not final | Fee base and tax treatment are open. Rounding, refunds, and disputes have proposed rules in [../foundation/business-model.md](../foundation/business-model.md). | Block Cloud production payments until the rules are accepted and tested. |
| Name and brand | Renaming late touches code, domains, and docs. | Resolved: "Cohory" is the final name (founder decision, 2026-10-19). |

## 9. Decisions and open questions

Confirmed:
- MVP contents and deferred items from the brief.
- Four member tabs, Manage sections, content created where it lives.
- 2% Cloud platform fee, 0% self-hosted, processing fees separate.

Recommendation:
- MVP equals roadmap phases 1 to 4.
- Posts: rich text, images, video embeds, links, mentions. No polls or attachments.
- Courses: modules, lessons, video by URL, markdown, attachments, all-members access only.
- Events: single and weekly recurring, RSVP, reminder, .ics.
- Gamification: points from likes received, and optionally from finished lessons and attended events, 9 fixed levels with renamable names, courses locked until a level, 7-day and all-time leaderboards with the level ladder.
- Memberships: one paid plan, monthly and optional annual, one currency, no trials.
- Members CSV export and an informational Migration section in Settings.
- WCAG 2.2 AA as the accessibility target.

Assumption:
- Creators accept externally hosted video for MVP.
- Stripe Checkout and the customer portal are acceptable member billing UI.

Open question:
- Level thresholds.
- Fee base with taxes. Rounding (integer minor units, round half up), proportional fee refunds, and fee refunds on lost disputes are proposed in [../foundation/business-model.md](../foundation/business-model.md) and need founder sign-off.
- Cloud resource limits per community.
- Session handling across custom domains.
