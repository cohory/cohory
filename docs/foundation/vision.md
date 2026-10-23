# Vision

The long-term direction for Cohory: what we are building, for whom, and what we refuse to become.

## Vision statement

**Confirmed.** Creators truly control their businesses. Their community, members, content, customer relationships, payment provider, subscriptions, data, and hosting belong to them, and they can move between our managed cloud and their own server without starting over.

Put plainly: a creator should be able to leave us on a Tuesday and still collect revenue on Wednesday.

## The three ideas behind the vision

### 1. Creator control

Most community platforms bundle three things that should be separate:

| Layer | Typical hosted platform | Cohory intent |
|---|---|---|
| Software | Proprietary, rented monthly | Open source, self-hostable, or managed by us |
| Data | Exportable in part, often as screenshots or partial CSVs | Exportable in documented, open formats |
| Revenue relationship | Subscriptions live in the platform's payment account | Subscriptions live in the creator's own payment account |

**Confirmed.** Creator-owned billing is the main differentiator. On the Cloud Edition with Stripe Connect, subscriptions are created on the creator's connected account. On the Community Edition, the creator connects their own provider directly and we are not in the money flow at all.

**Recommendation.** Use Stripe Connect connected accounts with full Dashboard access, Stripe as the processing fee and loss collector (the Accounts v2 configuration defined in [../architecture/payments.md](../architecture/payments.md)). The legacy Standard account type is deprecated for new platforms. Use direct charges so that the creator holds a full Stripe account they can keep after disconnecting from us. The trade-offs are covered in [../architecture/payments.md](../architecture/payments.md).

### 2. Portability that will be implemented and tested

**Confirmed.** Portability must be implemented and tested, not promised.

This is a product requirement, not a marketing line. In practice it means:

- A documented export format for communities, members, posts, comments, courses, lessons, events, and membership records.
- An automated test that exports a Cloud community and imports it into a fresh Community Edition instance, then checks that content, members, and entitlements match.
- A written offboarding procedure that explains what happens to active subscriptions, application fees, and the payment account when a creator leaves the Cloud Edition.

**Confirmed.** We never promise unconditional portability. Data export and continued payment collection are different things. We can always hand over data. Whether payment collection continues uninterrupted depends on the provider, the account type, and what the creator does next. Our docs must say this every time portability is mentioned.

### 3. Humans and agents

**Confirmed.** The product serves human members and creators first. Over time it will also serve AI agents: agents that help creators run a community, and agents that consume structured courses to learn and apply workflows.

The rules that keep this safe and useful:

- Every action a human can take in the UI will be available through a documented API. MCP is planned as a first-class interface on top of that API (post-MVP).
- Agents get their own identity, scoped permissions, and an audit trail. They never get unrestricted financial or admin rights.
- Human approval is required for agent actions that move money, change access, or publish on behalf of the creator, unless the creator explicitly loosens a specific rule.
- External course content and downloaded skills are untrusted input.

Details live in [../architecture/agent-integrations.md](../architecture/agent-integrations.md).

## What Cohory is

- A community platform with exactly four member areas: Community, Classroom, Calendar, Members.
- A place to run a paid membership business with posts, courses, events, and light gamification.
- Open-source software (Community Edition) that a creator or developer can run on a small VPS.
- A managed hosting service (Cloud Edition) with no mandatory monthly subscription and a 2% platform fee on successful transactions.
- An API-first system that developers, agencies, and agents can build on.

## What Cohory is not

| Not this | Why |
|---|---|
| A marketing suite (funnels, landing page builders, email campaigns) | Kajabi and others do this. It would bloat the product and dilute the four-area model. |
| A chat app competing with Discord or Slack | Real-time chat changes the product's rhythm. Direct messages are post-MVP and scoped narrowly. |
| A marketplace that owns the buyer relationship | We do not route members through a Cohory storefront or claim them as our customers. |
| A merchant of record for creators | **Assumption.** The creator is the intended merchant of record, subject to legal review and Stripe configuration. |
| A native mobile app (for now) | A responsive web app with bottom navigation comes first. Native apps are long-term. |
| A no-code automation builder | Complex automation builders are explicitly deferred. Agents and the API cover advanced needs. |
| A hosted agent execution service | We expose APIs and MCP. Running agents for customers is deferred. |

## Five-year picture (intent, not prediction)

The following describes what we intend to have built if the strategy works. It is not a forecast of adoption, revenue, or market share.

**Year 1 intent.** A creator can launch a paid community on the Cloud Edition or on a VPS, with posts, courses, events, a leaderboard, and Stripe Connect memberships. Docker Compose self-hosting works on a small server. The export format exists and round-trips.

**Year 2 intent.** Creators can bring existing communities and subscribers from other platforms through importers (Skool, Circle, generic CSV and API), with the limits of each source documented honestly. Bring Your Own Payment Provider works for at least one non-Stripe provider. The REST API is complete and documented with OpenAPI.

**Year 3 intent.** An MCP server lets agents such as Claude or Codex manage communities within scoped, audited permissions. Creators use agents to draft posts, schedule events, and find disengaged members, with human approval where it matters.

**Year 4 and 5 intent.** Courses can be published in an agent-readable form: structured lessons, reference material, executable exercises, and evaluations. A human buys a course, delegates access to their agent, and the agent's results are checked against the course's evaluations. Developers and agencies extend the platform through a stable plugin SDK.

Throughout all five years, the member experience stays as calm as it was on day one. If a later capability cannot fit within the four member areas and the five Manage sections, it belongs in the API, not in the UI.

## Product shape

**Confirmed.** The shape of the product is fixed early so that every later feature has a home.

Member areas (the only four tabs, bottom navigation on mobile):

| Area | What lives there |
|---|---|
| Community | The feed, posts, comments, likes, pinned announcements |
| Classroom | Courses, modules, lessons, progress |
| Calendar | Events, RSVPs, join links, recordings |
| Members | Member directory, profiles, leaderboard |

Creator admin ("Manage", visible to creators and authorized staff only):

| Section | What lives there |
|---|---|
| Overview | Health of the community at a glance: new members, revenue, activity |
| People | Members, roles, invitations, removals, bans |
| Payments | Connect a payment account, membership tiers, platform fee visibility |
| Appearance | Accent color, logo, cover image, font, card style, light or dark |
| Settings | Name, privacy, domain, notifications, and (Recommendation) Migration |

**Confirmed.** Content is created where it lives: posts in Community, lessons in Classroom, events in Calendar. Manage is for configuration, not content.

## Long-term commitments

These commitments should survive every future pivot. Changing one requires a written decision record in [../decisions/README.md](../decisions/README.md).

1. The Community Edition will always include every core feature needed to run a paid community. We do not move core features into the cloud only.
2. The Community Edition will never charge a platform fee.
3. The Cloud Edition will never require a monthly subscription to use core features.
4. Export formats will be documented and versioned. Breaking changes ship with a converter.
5. Subscriptions created through Stripe Connect on the Cloud Edition live in the creator's account.
6. Agents will never receive payment payout or account ownership permissions.

## How we will know the vision is real

These are checks, not metrics targets.

- A creator can export their community and import it into a self-hosted instance without our help.
- A creator who disconnects Stripe from the Cloud Edition keeps their subscriptions in their own Stripe account, and no further platform fees are charged on them.
- A self-hosted instance runs every MVP feature with no call to any cohory-operated service.
- A new member can find a post, a course, an event, and a person within one tap of the main navigation.
- Every agent action is attributable to a named agent identity and visible in the audit log.

## Related documents

- [mission.md](mission.md) for what we do this year.
- [principles.md](principles.md) for how we make trade-offs.
- [business-model.md](business-model.md) for editions and fees.
- [roadmap.md](roadmap.md) for phase ordering.
- [../product/mvp-scope.md](../product/mvp-scope.md) for the MVP cut.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Creators control community, members, content, customer relationships, payment provider, subscriptions, data, and hosting. |
| Confirmed | Portability must be implemented and tested. Data export is distinct from continued payment collection. |
| Confirmed | Humans first, agents supported through scoped identities and approvals. Agents never receive unrestricted financial or admin permissions. |
| Recommendation | Stripe Connect connected accounts with full Dashboard access (Accounts v2 configuration) and direct charges, so the creator keeps a full Stripe account after leaving. |
| Recommendation | A round-trip export and import test (Cloud to Community Edition) is a release gate from Phase 5 onward. |
| Assumption | The creator is the merchant of record on Stripe Connect direct charges. Requires legal review. |
| Recommendation | Polar is the first Bring Your Own Payment Provider beyond Stripe (built in 0.5.0, engineering choice). |
| Confirmed | "Cohory" is the final product name (founder decision, 2026-10-19). |
