# Target audience

Who Cohory is for, described as audience segments and working personas, with a snapshot of the alternatives they use today.

Status: Draft, 2026-10-17

**Assumption.** Everything in this document is a hypothesis. No user research, interviews, surveys, or market studies have been conducted. Personas are composites built from the founder brief and from common patterns in the creator economy. They must be validated (see "Validation plan") before they drive major decisions. No quotes in this document come from real people.

## Audience segments

### Primary

**Confirmed.** Independent creators operating paid communities.

Working definition (**Assumption**): one person or a very small team, running a community where members pay a recurring fee (typically monthly or annual) for access to discussion, courses, and live calls. The creator is the brand. They are not technical and do not want to become technical.

What they need most from us: a simple product, low fixed cost, and confidence that their recurring revenue is safe if they leave.

### Secondary

**Confirmed.** Coaches, educators, course creators, membership businesses, agencies, developers, and open-source enthusiasts.

| Segment | Why they come | What they value most |
|---|---|---|
| Coaches | Group coaching programs with calls and accountability | Calendar, simple payments, member progress |
| Educators and course creators | Courses with a discussion layer | Classroom quality, lesson player, progress |
| Membership businesses | Larger paid memberships with staff | Roles, member management, payment reporting |
| Agencies | Build and run communities for clients | Custom domains, white labeling, API, multi-community |
| Developers | Run a community for a product or open-source project, or build on the platform | Self-hosting, API, extensibility, license |
| Open-source enthusiasts | Want an open alternative to closed platforms | Self-hosting, governance, contribution path |

### Future

**Confirmed.** Two future audiences, both long-term:

- Creators selling agent-compatible courses, where a buyer's agent consumes structured lessons, exercises, and evaluations.
- Organizations using AI agents to automate community management and learning.

These audiences shape architecture now (structured course content, agent identities, scoped permissions) but do not shape the MVP UI.

## Personas

Six working personas. Four describe the primary and secondary audience, one the developer and agency audience, and one the future audience. Names are invented.

### Persona 1: Maya, the coach who outgrew a Facebook group (primary)

- **Context.** Runs a fitness accountability community. Started free on social media, moved to a hosted community platform, now has a few hundred paying members on a monthly plan. Works alone with a part-time assistant.
- **Jobs to be done.** Post a daily prompt, run two live calls a week, keep a short starter course, see who stopped showing up, get paid every month without chasing anyone.
- **Frustrations.** Fixed monthly platform cost that feels heavy in slow months. Feeling that the platform, not she, owns the subscriber relationship. Limited branding.
- **Motivations.** Lower fixed costs, a cleaner look that feels like her brand, confidence the business would survive if the platform changed terms.
- **Switching barriers.** Moving paying members is the big one. Asking hundreds of people to re-enter card details risks losing a large share of them. Re-uploading course videos. Members' habit of opening the current app.
- **What would make her leave her current platform.** A clear path to move members and, where possible, subscriptions without re-entering payment details. Equal or better simplicity. Paying only when she earns.

### Persona 2: Daniel, the course creator with a cost problem (primary)

- **Context.** Sells a professional skills course with a community attached. Uses an all-in-one course platform plus a separate community tool. Has an annual plan and a cohort launch twice a year.
- **Jobs to be done.** Launch a cohort, gate modules by date or progress, run weekly Q&A events, answer questions in one place.
- **Frustrations.** Paying for two tools. Members confused about where to go. Course and community data in separate silos.
- **Motivations.** One place for course and community. Predictable cost that scales with revenue.
- **Switching barriers.** Funnels and email automations he built in the current tool (out of scope for us). Existing annual subscribers mid-term.
- **What would make him leave.** A classroom that is genuinely good (progress, resume, gating) and a migration path for course structure. He will likely keep a separate email tool.

### Persona 3: Ana, the educator who wants control over member data (secondary)

- **Context.** Runs a language learning community for a small school in the EU. Mix of free and paid members. Cares about data protection rules and where data is stored.
- **Jobs to be done.** Host weekly conversation events across time zones, keep lesson material organized by level, answer data access requests from members.
- **Frustrations.** Unclear data location on hosted platforms. Tracking scripts she did not add. Difficulty fulfilling a member's data deletion request.
- **Motivations.** Self-hosting or EU hosting, clear privacy defaults, accessible interface for older learners.
- **Switching barriers.** Limited technical skill on staff. Fear of maintaining a server.
- **What would make her leave.** Either a managed option with a clear data location, or a self-hosting setup simple enough for a contractor to maintain with a documented backup and upgrade procedure.

### Persona 4: Priya, the developer who runs a product community (secondary)

- **Context.** Maintains an open-source developer tool and runs its community on a chat server plus a forum. Wants courses for onboarding and a calmer space than chat.
- **Jobs to be done.** Host a community on her own infrastructure, single sign-on with her product's accounts, integrate with GitHub and her docs, script moderation.
- **Frustrations.** Chat buries knowledge. Closed platforms do not allow self-hosting or deep integration. Forums feel dated for courses.
- **Motivations.** Open source, a clean API, a license she can explain to her company, reasonable resource needs.
- **Switching barriers.** Existing chat habits in her community. Concern about project longevity and governance.
- **What would make her leave her current tools.** A self-hostable product with an OpenAPI spec, webhooks, and an active repository with clear governance.

### Persona 5: Lena, the agency owner (secondary, "WordPress for Communities" direction)

- **Context.** Runs a small agency that builds membership sites for clients. Has used WordPress with membership plugins and found maintenance costly.
- **Jobs to be done.** Spin up branded communities for several clients, use client domains, add small custom features, hand over day-to-day management to the client.
- **Frustrations.** Plugin conflicts and upgrade breakage. Per-seat or per-community pricing that eats her margin. No clean way to customize closed platforms.
- **Motivations.** A stable core with an extension point, client-owned billing so she is not in the money flow, the ability to self-host for some clients and use cloud for others.
- **Switching barriers.** Existing client sites. Need for a plugin SDK that does not exist yet (long-term).
- **What would make her leave her current stack.** Custom domains, multi-community management under one login, and an API stable enough to build on. A plugin SDK later.

### Persona 6: Sam, the operations lead using agents (future)

- **Context.** Runs customer education and community for a software company. Already uses AI assistants for drafting and analysis.
- **Jobs to be done.** Have an agent summarize weekly discussions, flag unanswered questions, draft announcements, schedule office hours, and report on course completion.
- **Frustrations.** Agents can only reach closed platforms through brittle scraping or limited exports. No audit trail of what an assistant did.
- **Motivations.** An MCP server and API with scoped permissions, approval steps, and logs that compliance can review.
- **Switching barriers.** Procurement and security review. Single sign-on requirements.
- **What would make Sam choose us.** Agent identities with scoped, revocable permissions and an audit log, plus a documented security posture.

## Persona priorities

| Persona | Audience | MVP focus | Notes |
|---|---|---|---|
| Maya | Primary | Yes | The default persona for UX decisions. |
| Daniel | Primary | Yes | Drives Classroom quality. |
| Ana | Secondary | Partly | Drives privacy defaults and self-hosting docs. |
| Priya | Secondary | Partly | Drives API, self-hosting, license. |
| Lena | Secondary | Post-MVP | Drives custom domains, multi-community, SDK. |
| Sam | Future | Long-term | Drives agent identity and audit design now, UI later. |

**Recommendation.** When personas conflict in the UI, Maya wins. When they conflict in the API or self-hosting, Priya wins.

## Common switching barriers and how we plan to address them

| Barrier | Planned answer | Phase |
|---|---|---|
| Paying members must re-enter cards | Link existing Stripe subscriptions when the creator already owns the Stripe account. Where card data is held by another platform, document what is and is not possible. | 3 and 5 |
| Re-uploading course content | Importers for course structure, plus bulk upload | 5 |
| Members' habits | Familiar four-tab layout, email digest, custom domain | 1 and 4 |
| Fear of maintaining a server | Cloud Edition, or a documented Docker Compose setup with backups | 4 |
| Project longevity | Open governance, clear license, public roadmap | 0 |

**Confirmed.** We never promise that subscriptions can always be moved without action from members. Some source platforms do not give creators access to payment methods. See [../architecture/payments.md](../architecture/payments.md).

## Competitor snapshot

**Assumption.** The table below is copied from the founder's notes. Pricing and positioning are founder-provided and unverified. Prices change often and may depend on billing period, region, and plan. Verify against each vendor's current pricing page before using any figure in public material.

| Platform | Best for | Starting price (unverified) | Main strength |
|---|---|---|---|
| Circle | Professional paid communities | $89/mo | Community, courses, branding, migrations |
| Mighty Networks | Community-first businesses | $79/mo | Engagement, courses, mobile apps |
| Heartbeat | Smaller membership communities | $49/mo | Chat, events, courses, automation |
| Kajabi | Course creators and coaches | $143/mo | Marketing, funnels, courses, email |
| Whop | Selling digital products and memberships | No required monthly platform plan | Monetization and marketplace |
| Discourse | Self-hosted communities | Free self-hosting | Open source, customization |
| LearnHouse | Open-source course platforms | Free self-hosting | Courses and learning management |

Skool is not in the founder's table. Its pricing and fee structure must be researched and verified before any comparison is published.

### Where we intend to differ (hypotheses)

- Compared with Skool: open source, self-hostable, creator-owned subscriptions, and no mandatory monthly fee on the Cloud Edition. Similar simplicity is a requirement, not a differentiator.
- Compared with Circle, Mighty Networks, Heartbeat, Kajabi: no fixed monthly plan, fewer features, calmer interface, and ownership of billing.
- Compared with Whop: community and learning first, not a marketplace. We do not own the buyer relationship.
- Compared with Discourse: a creator-oriented product with courses, events, and paid memberships built in, rather than a forum that needs plugins.
- Compared with LearnHouse: community and payments are first-class, not only courses.

## Validation plan

**Recommendation.** Before Phase 3 ends, validate the primary persona with at least the following, and update this document with findings:

1. Structured conversations with creators currently running paid communities on Skool, Circle, or Mighty Networks, focused on switching barriers and payments.
2. A review of public documentation from those platforms on export and subscription transfer, recorded with dates.
3. A usability test of the community creation and Stripe connection flow with non-technical creators.
4. Tracking of which persona each early Community Edition and Cloud Edition user most resembles, with consent.

Results replace assumptions in this document. Any change in primary persona needs a decision record.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Primary audience: independent creators operating paid communities. Secondary and future audiences as listed. |
| Assumption | All personas and their frustrations, motivations, and barriers. None are validated. |
| Assumption | Competitor pricing is founder-provided and unverified. |
| Recommendation | Maya is the default persona for UI decisions, Priya for API and self-hosting decisions. |
| Recommendation | Run the validation plan before the end of Phase 3. |
| Open question | Is the primary persona more often a solo creator (Maya) or a small business with staff? This affects how early roles and permissions need depth. |
| Open question | Which source platform do most likely switchers come from? This decides importer order in Phase 5. |
| Open question | Skool's current pricing and fees, to be verified before any public comparison. |
