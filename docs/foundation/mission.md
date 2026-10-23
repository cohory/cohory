# Mission

What Cohory exists to do, what we commit to in the first year, and what we deliberately leave out.

## Mission statement

**Recommendation.** Give creators a calm, open-source home for their paid community, where the members, the content, and the recurring revenue stay theirs.

Shorter internal form: **simple to run, yours to keep.**

The mission is narrower than the vision in [vision.md](vision.md) on purpose. The vision covers agents, agent-ready courses, and a developer platform. The mission covers what a creator gets from us now: a community they can launch in an afternoon and leave without losing their business.

## Who the mission serves first

**Confirmed.** Independent creators operating paid communities are the primary audience. Coaches, educators, course creators, membership businesses, agencies, and developers are secondary. Personas and hypotheses are in [target-audience.md](target-audience.md).

When a decision helps a developer but makes the product harder for a non-technical creator, the creator wins in the UI and the developer gets an API or configuration file instead.

## What we do this year

"This year" means the work in roadmap Phases 0 to 4 (see [roadmap.md](roadmap.md)). No calendar dates are attached. The year is defined by scope, not by deadline.

### Commitments

**Confirmed.** The MVP includes:

1. Authentication (email and password and magic link in MVP; OAuth providers and two-factor authentication follow after MVP; see [../product/mvp-scope.md](../product/mvp-scope.md)).
2. Community creation with name, description, privacy (public or private), and branding.
3. Member management: invite, approve, remove, ban, assign roles.
4. Posts and comments in the Community area, with likes and categories.
5. Basic courses: courses, modules, lessons, and progress tracking, open to all members (gated access by tier or level is Post-MVP).
6. Basic events: one-off and recurring events with time zones, RSVPs, and join links.
7. Simple gamification: points from likes, levels, and leaderboards (level-gated course unlocks are Post-MVP).
8. Stripe Connect payments on the Cloud Edition and direct Stripe on the Community Edition.
9. Paid memberships: free or one paid plan with monthly and optional annual prices, with access derived through entitlements.
10. A responsive UI with the four member tabs as bottom navigation on mobile.
11. Docker Compose self-hosting with documented install, backup, and upgrade steps.

**Recommendation.** Two additions belong in the first year even though they are small:

- A members CSV export (with Stripe customer and subscription IDs) in MVP, so early creators are never trapped, followed by a versioned JSON export of a whole community and its import in Phase 5.
- A public REST API covering read access to every MVP object and write access to posts, comments, events, and members, documented with OpenAPI. The internal API and its OpenAPI document exist from Phase 1; public tokens and the stability promise arrive in Phase 6 together with MCP (roadmap).

### How we will judge the year

These are qualitative release checks, not growth targets.

- A creator with no technical background can create a community, connect Stripe, set a price, and invite a first member without reading documentation.
- A developer can run the Community Edition on a small VPS by following the README, with no cohory-operated service required.
- The platform fee shown to the creator in Payments matches the fee recorded in the ledger and the fee taken by Stripe, to the minor unit, for every test transaction.
- Every MVP screen passes the accessibility checks in [product-requirements.md](product-requirements.md).

## Non-goals

These are things we will not do this year, and in several cases ever. Each has a reason so that contributors can argue with the reason rather than the conclusion.

| Non-goal | Reason | Revisit when |
|---|---|---|
| Native iOS and Android apps | A responsive web app covers the four tabs. Native apps double the surface area. | After the web app is stable and a push notification gap is proven. |
| Direct messaging | DMs bring moderation, abuse, and real-time infrastructure costs. | Post-MVP, as a scoped feature with creator controls. |
| Real-time chat channels | Changes the product from calm async community to chat. | Not planned. |
| Funnels, landing page builders, email marketing campaigns | Outside the four member areas. Creators already use dedicated tools. | Not planned. Integrations via API instead. |
| Advanced analytics dashboards | Brief explicitly defers them. Overview shows a few honest numbers. | Long-term, likely through agents rather than charts. |
| Complex automation builders | Brief explicitly defers them. | Long-term, likely replaced by agent workflows. |
| Plugin marketplace | A marketplace needs a stable SDK, review, and security process first. | Long-term. |
| AI course generation | Deferred by the brief. Agent features start with the API and MCP. | Phase 6 and later. |
| Hosted agent execution | We expose tools, we do not run customers' agents. | Long-term. |
| Bring Your Own Payment Provider | Provider capabilities differ. Doing Stripe well first is safer. | Post-MVP, Phase 5 or later. |
| Migration importers (Skool, Circle) | Valuable but source formats are unstable. | Phase 5. |
| Native video transcoding | Expensive to run and to self-host. | **Recommendation.** Post-MVP. MVP lessons embed video by URL from external hosts. |
| Multi-currency pricing per tier | Complicates tax, fee, and reporting logic. | Post-MVP. MVP supports one currency per community. |

## Editions this year

**Confirmed.** Both editions ship from the same codebase.

| Edition | First-year state | What it costs the creator |
|---|---|---|
| Community Edition | Public release at the end of Phase 4. Earlier builds available to early self-hosters from Phase 1. | Nothing from us. Server costs and payment processing fees are the creator's. 0% platform fee. |
| Cloud Edition | Private beta during Phase 3, public at the end of Phase 4. | No monthly subscription. 2% platform fee on successful transactions. Processing fees separate. Fair-use limits apply (see [business-model.md](business-model.md)). |

**Recommendation.** The Cloud Edition does not process live payments until the fee base, rounding, taxes, refunds, and disputes in [business-model.md](business-model.md) have been reviewed by legal and accounting advisors.

## What we ask of contributors this year

Open-source contributors are part of the mission, not an afterthought. In the first year we commit to:

- A public roadmap ([roadmap.md](roadmap.md)) and public decision records ([../decisions/README.md](../decisions/README.md)).
- Labeled starter issues for each phase, with acceptance criteria copied from [product-requirements.md](product-requirements.md).
- Reviews on pull requests that state which principle a requested change protects, so feedback is predictable.
- No contributor license agreement. Contributions use a DCO sign-off (**Confirmed**, founder, 2026-10-19; see [../../CONTRIBUTING.md](../../CONTRIBUTING.md)).

In return, contributions must:

- Keep the four member tabs and five Manage sections intact.
- Include tests for any change touching money, authentication, permissions, or subscriptions.
- Pass accessibility and performance checks in CI.
- Avoid adding a hosted dependency to the Community Edition.

## How the mission constrains decisions

- If a feature needs a fifth member tab, it is out of scope or it moves into an existing tab.
- If a feature works only on the Cloud Edition, it must be infrastructure (managed hosting, custom domain provisioning, automatic updates), not product.
- If a feature puts Cohory between the creator and their subscribers' payment relationship, it is rejected or redesigned.
- If a feature cannot be explained in a plain sentence in the creator UI ("Connect your Stripe account", "Platform fee: 2%"), it is not ready.

## Related documents

- [vision.md](vision.md)
- [principles.md](principles.md)
- [business-model.md](business-model.md)
- [roadmap.md](roadmap.md)
- [../product/mvp-scope.md](../product/mvp-scope.md)

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Primary audience is independent creators operating paid communities. |
| Confirmed | MVP scope is the eleven items listed under Commitments. |
| Confirmed | DMs, BYO payment provider, migration importers, MCP, and agent courses are post-MVP or long-term. |
| Recommendation | Mission statement: "Give creators a calm, open-source home for their paid community, where the members, the content, and the recurring revenue stay theirs." Final wording belongs to [../brand/brand-strategy.md](../brand/brand-strategy.md). |
| Recommendation | Members CSV export in MVP, versioned JSON export in Phase 5, public REST API with OpenAPI in Phase 6. |
| Recommendation | No video upload or transcoding in MVP. Lessons embed video by URL. |
| Recommendation | One currency per community in MVP. |
| Open question | Which OAuth providers ship first after MVP (Google only, or Google plus GitHub)? |
| Confirmed | No contributor license agreement; contributions use a DCO sign-off (founder decision, 2026-10-19). |
| Open question | Is a creator allowed to run more than one community under one account at MVP? (Proposed default: yes, each with its own payment connection.) |
