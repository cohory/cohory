# Brand strategy

What the brand stands for, how we position it, and the words we lead with on the homepage, GitHub, and in product.

The product name is Cohory (founder decision, 2026-10-19). The [naming exploration](#naming-exploration) is kept for the record.

Related: [voice and tone](./voice-and-tone.md), [visual identity](./visual-identity.md), [design tokens](./design-tokens.md), [information architecture](../product/information-architecture.md), [payments architecture](../architecture/payments.md).

## Mission

**Recommendation:** Give creators software that lets them truly control their communities, members, content, and revenue.

## Vision

**Recommendation:** A creator can run a paid community without renting their business from a platform. They can start on the managed cloud, move to their own server, and take their members, courses, posts, and payment relationships with them. Portability is something we implement and test, not something we claim.

## Brand promise

**Recommendation:** Simple enough to launch in an afternoon. Open enough that you never have to ask permission to leave.

The promise has two halves on purpose. The first is about the member and creator experience (calm, few choices, good defaults). The second is about ownership (open source, self-hosting, creator-owned payment accounts, documented exports). If a feature makes one half worse, it needs a strong reason.

## Brand personality

**Recommendation:** five traits. Each has a boundary, because a trait without a limit drifts.

| Trait | We are | We are not |
| --- | --- | --- |
| Calm | Quiet layouts, few colors, steady pacing, no urgency tricks | Sleepy, vague, or hiding important information |
| Friendly | Warm, plain words, written for a coach or teacher, not an engineer | Cute, jokey, overly casual, or full of exclamation marks |
| Trustworthy | Exact about money, fees, data, and limits. We say what is not built yet | Corporate, legalistic, or reassuring without proof |
| Open | Source available, decisions documented, roadmap in public, easy to leave | Ideological, preachy about open source, or hostile to paid software |
| Capable | Solid APIs, clear docs, developer and agent ready under the surface | Technical on the surface, jargon heavy, or configuration first |

## Positioning

### Positioning statement

**Recommendation:** For independent creators who run paid communities, Cohory is an open-source community platform that combines a feed, courses, events, and memberships in one calm app. Unlike closed community platforms, Cohory can be self-hosted for free, and on the managed cloud the creator's subscriptions live in the creator's own payment account, with a 2% platform fee and no monthly plan.

### Positioning directions

**Confirmed:** the founder notes list three directions. They are not mutually exclusive, but one must lead the homepage.

| Direction | Audience | Differentiation | Where it shows up |
| --- | --- | --- | --- |
| Open-source Skool | Creators and coaches | Simplicity and ownership | Homepage hero, launch posts, comparison pages |
| WordPress for communities | Developers and agencies | Plugins, themes, extensibility | GitHub README, developer docs, SDK pages (post-MVP) |
| Community infrastructure | SaaS founders and businesses | APIs, white labeling, custom domains, embeddable components | API docs, a later "for teams" page (long-term) |

**Recommendation:** lead with "Open-source Skool" for the MVP launch. It names a category people already understand, it matches the MVP scope (feed, courses, events, memberships, Stripe Connect, Docker self-hosting), and it lets the other two directions grow from real usage. Use the competitor name only in comparison contexts (for example "an open-source alternative to Skool"), never in the product name, logo, or visuals.

**Open question:** whether "alternative to Skool" stays in the GitHub description after launch, or moves to a comparison page once the project has its own recognition.

## Messaging hierarchy

### Core message

**Recommendation:** Run your community on software you control. Free to self-host. 2% on the cloud when you earn. Your subscribers stay in your own payment account.

### Pillar 1: Simplicity

Members see four tabs (Community, Classroom, Calendar, Members) and every screen has one obvious primary action.

Proof points:
- **Confirmed:** member navigation is exactly four tabs, the same in every community, with bottom navigation on mobile.
- **Confirmed:** content is created where it lives. Posts in Community, lessons in Classroom, events in Calendar.
- **Confirmed:** creator settings use plain language ("Connect your Stripe account", not "Stripe Connect OAuth Configuration").
- **Recommendation:** a creator can publish a first post in one or two interactions, and a member can resume a course from the community home. These become acceptance criteria, not slogans.

### Pillar 2: Ownership

Your community, members, content, and subscriptions belong to you, and leaving is a documented path.

Proof points:
- **Confirmed:** Community Edition is self-hosted, open source, and charges a 0% platform fee.
- **Confirmed:** Cloud Edition has no mandatory monthly subscription and a 2% platform fee on successful transactions. Payment processing fees are separate and charged by the provider.
- **Confirmed:** on Cloud, Stripe Connect uses direct charges on the creator's connected account, so subscriptions and saved payment methods live in the creator's Stripe account.
- **Recommendation:** data export (members, courses, posts, comments) ships as a tested feature with a documented format. We separate "your data is exportable" from "payment collection continues after you leave", and only claim the second where the payment setup supports it (see [payments architecture](../architecture/payments.md)).

### Pillar 3: Openness for agents and developers

Everything a person can do in the UI will be available through a documented API, with agent access that is scoped, logged, and approved by a human.

Proof points:
- **Confirmed:** the platform is API-first, with an OpenAPI description planned at `/api/openapi.json`.
- **Recommendation:** MCP server, agent identities, scoped permissions, and audit logs are planned post-MVP. Agents never receive unrestricted financial or admin permissions.
- **Confirmed:** the stack is mainstream and documented (TypeScript, Next.js, PostgreSQL, Drizzle, Tailwind CSS, shadcn/ui), deployed with Docker Compose.

## Tagline candidates

**Confirmed** (founder):
1. Your community. Your subscribers. Your business.
2. Free to start. Just 2% when you earn. Own your community.
3. The open-source community platform for creators.

**Recommendation** (additional):
4. Community software you can take with you.
5. A calm home for your community.
6. Build your community. Keep your business.
7. Self-host for free, or let us run it for 2%.
8. Open source. Creator owned. Quietly simple.
9. Moving your community is hard. Moving payments is harder. We plan for both.
10. Teach, gather, and get paid on software you control.
11. Your members, your courses, your Stripe account.

**Recommendation:** use #3 as the GitHub and meta description line, #1 as the homepage hero, and #2 as the pricing headline. Any tagline that claims ownership must link to the pricing and portability details that back it up.

## Homepage messaging

**Recommendation:** draft copy for the MVP homepage. Capabilities marked planned must not appear as available.

**Hero:** Your community. Your subscribers. Your business.

**Subhead:** Cohory is an open-source home for your community, courses, and events. Self-host it for free, or use our cloud with no monthly plan and a 2% platform fee when you earn.

**Primary CTA:** Start your community
**Secondary CTA:** Self-host on GitHub

**Feature block 1. Everything in four tabs.** Community, Classroom, Calendar, and Members. Your members always know where things are, on desktop and on their phone.

**Feature block 2. Courses next to conversation.** Build courses from modules and lessons, and let members pick up where they left off straight from the feed.

**Feature block 3. Payments in your own account.** Connect your Stripe account and sell memberships. Subscriptions and payment methods stay in your Stripe account, not ours.

**Pricing block:**
- Heading: Free to start. Just 2% when you earn.
- Self-hosted: $0. No platform fee. You run the server.
- Cloud: $0 per month. 2% platform fee on successful transactions. We run the servers, updates, and backups.
- Footnote: Payment processing fees are charged by your payment provider and are not included in the platform fee.

**Open-source block:**
- Heading: Open source, for real.
- Body: The code is on GitHub. Run it on your own server with Docker Compose, read how it works, and contribute. The cloud runs the same core you can self-host.
- Link: Read the self-hosting guide

**Closing CTA:**
- Heading: Bring your community home.
- Button: Start your community
- Link: Compare self-hosted and cloud

**Open question:** whether "backups" can be promised for Cloud at launch. Remove it from the pricing block if the backup policy is not defined.

## GitHub repository

**Recommendation:** description (293 characters):

> Open-source community platform for creators. Community feed, courses, events, and paid memberships in one calm app. Self-host for free with Docker, or use the managed cloud with no monthly plan and a 2% platform fee. Subscriptions stay in your own Stripe account. API-first, agents planned.

**Recommendation:** topics:

`community-platform`, `skool-alternative`, `open-source`, `self-hosted`, `online-community`, `online-courses`, `lms`, `membership`, `creator-economy`, `stripe-connect`, `nextjs`, `typescript`, `postgresql`, `drizzle-orm`, `tailwindcss`, `shadcn-ui`, `docker`

**Assumption:** naming a competitor in a GitHub topic is acceptable descriptive use. Confirm with legal counsel before launch.

## Naming exploration

**Confirmed** (founder, 2026-10-19): "Cohory" is the final name. The list below is the exploration that came before. **Assumption:** none of the names below has been checked for domain availability, trademark conflicts, package registry names, or social handles. Many are common words and likely taken in some form. Treat this as a direction board, not a shortlist.

| Name | Direction | Rationale |
| --- | --- | --- |
| Stillroom | Calm | A quiet room in an old house where things were made by hand; calm and craft at once |
| Harbor | Calm | A safe place to gather and rest; risk of being very common |
| Meadow | Calm | Open, soft, and spacious, like the interface we want |
| Hearth | Belonging | The center of a home where people gather; warm without being cute |
| Kinfold | Belonging | Invented compound of kin and fold; suggests being brought into a group |
| Burrow | Belonging | A small, cozy home; playful, but may read as too small for businesses |
| Commonplace | Community | A commonplace book collects shared knowledge; also a public square |
| Quorum | Community | The people needed for a group to act; serious, slightly formal |
| Atrium | Community | The open central space of a building that every room faces |
| Lantern | Learning | Carrying light to others; fits teaching and courses |
| Fieldhouse | Learning | A place for practice and training; works for coaching communities |
| Waypoint | Learning | A marker on a route; matches course progress and "resume where you left off" |
| Homestead | Ownership | Land you live on and own; strong ownership message, rural tone |
| Freehold | Ownership | Ownership without a landlord; precise but legal sounding |
| Keep | Ownership | Both a stronghold and the verb "keep your members"; hard to search |
| Openfield | Freedom | Open land without fences; pairs with open source |
| Unfenced | Freedom | Directly says no lock-in; may read as negative or edgy |
| Cohory | Community, learning | Chosen (2026-10-19). Echoes cohort and community; unusual enough to search |

**Recommendation:** when choosing, score each finalist on: pronounceable on first read, spelling survives being said aloud, a usable `.com` or short alternative, no conflict with community, course, or payment software marks, and works in lowercase in code (`@<name>/ui`).

## What the brand must never do

- Never promise unconditional portability. Say what exports include and what depends on the payment provider.
- Never hide or soften fees. The 2% platform fee and separate processing fees are always shown together.
- Never present planned features (BYO payment provider, MCP, agent courses, migration importers) as available.
- Never use urgency or scarcity tactics (countdowns, "only 3 spots left", fake social proof).
- Never invent testimonials, user counts, or market research.
- Never copy another product's logo, color pairing, illustrations, or proprietary UI, including Skool, Circle, Linear, and Notion.
- Never attack competitors by name in ads or product UI. Comparisons are factual and dated.
- Never make the creator's community look like our product. The creator's logo, cover, and accent lead inside a community; our brand stays in the footer and account areas.
- Never imply that self-hosted users are second-class or nag them to move to Cloud.

## Decisions and open questions

- **Confirmed** (founder, 2026-10-19): "Cohory" is the final name.
- **Confirmed:** three positioning directions from the founder notes; founder taglines 1 to 3.
- **Confirmed:** pricing facts (0% self-hosted, 2% cloud, no monthly plan, processing separate).
- **Recommendation:** lead with "Open-source Skool" positioning for MVP launch.
- **Recommendation:** messaging pillars Simplicity, Ownership, Openness for agents and developers.
- **Recommendation:** homepage copy and GitHub description above.
- **Assumption:** no domain, trademark, or registry checks have been done for any name.
- **Assumption:** competitor names in topics and comparison copy are acceptable descriptive use, pending legal review.
- **Open question:** keep "alternative to Skool" in the GitHub description long-term?
- **Open question:** can Cloud promise backups at launch?
