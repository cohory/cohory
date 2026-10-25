# Changelog

All notable changes to Cohory are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may include breaking changes; they are listed under Changed.

## [Unreleased]

### Added

- A `docs-audit` skill for coding agents that checks every doc against the code before a release.

### Changed

- The published Docker image `ghcr.io/cohory/cohory` is public. The production env example pulls it by default, and the install guide explains how to build on the server instead.
- Custom domains per community moved from the MVP to a later phase, and every decision record up to 0052 is accepted.

## [0.12.0] - 2026-10-24

### Added

- The third party agent skills in `.claude/skills`, with their sources and terms in `THIRD_PARTY_NOTICES.md`.
- On Cloud with `COMMUNITY_CREATION=operators`, the landing and pricing pages offer Request early access and Self-host now instead of Create your community, and a short form at `/early-access` emails the request to `CONTACT_EMAIL`.
- A Contact page at `/contact`, linked from the footer, emails the operator with your account details when signed in, and is spam protected and rate limited.
- On Cloud, creators get one optional question after their first post, first paid member, and first course, and an optional reason when they archive, delete, disconnect Stripe, or delete their account; answers go to the operator and can be turned off.
- An optional creators community (`CREATORS_COMMUNITY_SLUG`) linked from every footer, with one invitation email to each new creator, and Send feedback links in the account menu, Manage Overview, and error pages.

### Changed

- Prepared the public release: a rewritten `.env.example` with production markers and a quickstart that starts Mailpit, payment test fixtures at the 2% fee, sandbox ids replaced with fakes, and `pnpm db:seed:paid` now needs `PAID_SEED_ACCOUNT_ID`.
- The development seed now creates the private Cohory Creators community and the paid Cohory Pro community instead of Cohories, and `pnpm db:reset:local --yes` resets and reseeds a local database.

### Fixed

- The logo on sign in and other account pages now sits just above the card instead of at the top of the page.
- The "Ask me how setup went" switch on Account, Notifications shows "Saving…" until the change is stored and "Saved." after, so leaving the page too early no longer looks saved.

## [0.11.0] - 2026-10-23

The first summarized release. Cohory 0.11.0 is an open source community platform for creators: a community feed, courses, events, and paid memberships in one app, with an API and MCP server for agents. Earlier versions were development snapshots.

### Community

- Communities with an About page, public or private visibility, and open, approval, or invite only joining with up to 3 join questions.
- Four member tabs: Community, Classroom, Calendar, and Members.
- Posts with rich text, up to 10 images, video embeds, mentions, categories, pinning, likes, scheduled posts, and announcement emails.
- Comments with one level of replies, likes, and following a post.
- Points, nine named levels, leaderboards, courses that unlock at a level, and optional points for lessons and events.
- Member reviews on the About page with an owner reply, reporting, and hiding.
- Moderation in Manage, Inbox: join requests, reports, and agent approvals.
- In app notifications, batched reply and mention emails, a daily or weekly digest, and per community preferences.
- Search across posts, comments, members, and lessons.

### Courses

- Courses with modules and lessons, drafts, drag and drop ordering, and per member progress.
- Lessons with Markdown, video by URL, and attachments up to 25 MB.
- Structured lessons for agents: instructions, references, tasks, and evaluations, with a local evaluation runner.

### Events

- One time and weekly events with RSVP, cancelled occurrences, month and list views, and the viewer's time zone.
- Reminder emails one hour before and `.ics` downloads.

### Payments

- One paid plan per community with monthly and annual prices, sold through Stripe Checkout.
- Stripe Connect on Cloud and the creator's own Stripe keys on self-hosted servers.
- Cancel at period end, pause for 1 to 3 months, past due handling, and a yearly renewal reminder.
- Comped access, existing subscriber import, and a guided move for paying members from another platform.
- A platform fee ledger, periodic billing for providers without a fee split, and fee removal when a creator disconnects.

### Agents and API

- REST API at `/api/v1` with an OpenAPI document and the typed `@cohory/sdk` client.
- Personal and agent API tokens with scopes, and OAuth for MCP clients.
- MCP server at `/mcp` with tools that call the same services as the API.
- Human approval for agent actions on money, roles, removals, and deletions, with an audit log.
- Signed outgoing webhooks with a delivery log.

### Migration

- Full archive export and import between Cohory servers.
- Importers for Skool, Circle, and member spreadsheets, with the owner choosing when invitation emails go out.

### Cloud

- Cloud Edition with a 2% platform fee on successful transactions and no monthly subscription.
- Creator landing, Pricing, and Open source pages, with the fee and fair use limits read from config.
- Fair use limits on storage and members per community.

### Self-hosting

- Community Edition with a 0% platform fee, one Docker image for web, worker, and migrations, and Compose files for development and production.
- Operator settings for sign up mode, who may create communities, instance name and logo, and a home community.
- Command line tools for migrations, billing, secrets, and accounts.

### Security and privacy

- Row level security on every community table, in addition to scoping in services.
- One authorization module for people, API tokens, and agents.
- Rate limits on sign in, invitations, and public writes, and a structured logger that redacts secrets.
- Account deletion, data download, legal pages, and consent at sign up.

[Unreleased]: https://github.com/cohory/cohory/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/cohory/cohory/releases/tag/v0.12.0
