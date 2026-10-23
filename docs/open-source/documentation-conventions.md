# Documentation conventions

The rules every Cohory doc follows: structure, labels, punctuation, links, terminology, diagrams, length, and where each kind of doc lives.

Status: Draft, 2026-10-17

The product name is written "Cohory" in prose, UI copy, emails, and page titles. Write "cohory" only in code, paths, package names, URLs, CLI commands, and other technical strings (founder decisions, 2026-10-19 and 2026-10-20). Older docs still use lowercase in prose; fix them when you touch them.

These rules apply to everything under `docs/`, the root Markdown files, and PR and issue text where it makes sense. They are **Confirmed** for the foundation phase and can change only through a decision record.

## Document structure

Every doc starts with:

1. An H1 title.
2. A one-line purpose: what the reader gets from this doc.
3. A Status line: `Status: Draft, 2026-10-17`. Allowed states are Draft, Accepted, and Deprecated. Update the date when the content changes meaningfully.

Every doc ends with a short "Decisions and open questions" section that lists the labeled statements in the doc.

Decision records in `docs/decisions` use their own template described in [decisions/README.md](../decisions/README.md), with the states Proposed, Accepted, Rejected, and Superseded.

## Labels

Label statements that are not plain facts with one of these four labels, in bold:

| Label | Meaning | Example |
|-------|---------|---------|
| **Confirmed** | A founder decision from the brief, or an Accepted decision record | Members see exactly four tabs |
| **Recommendation** | Our proposal, not yet confirmed | Use pg-boss as the default queue |
| **Assumption** | Something we believe but have not verified | Creators accept externally hosted video for MVP |
| **Open question** | Needs a decision before work that depends on it | Fee base when taxes apply |

Never upgrade a Recommendation to Confirmed in a doc without the founder decision or an Accepted record to point to.

## Writing style

- Specific, plain, practical. Lead with the answer.
- No generic startup language ("revolutionize", "seamless", "unlock", "empower").
- No emojis.
- Never use dashes as punctuation: no em dash, no en dash, no spaced hyphen between clauses. Use periods, commas, colons, or parentheses. Hyphens inside compound words (self-hosted, open-source, end-to-end) are fine. Write ranges as "0 to 7", not with a dash.
- Do not present future capabilities as implemented. Use "will", "planned", "MVP", "post-MVP", or "long-term".
- Never invent numbers, testimonials, user counts, or market validation. If a number is an estimate, say so.
- State money exactly: "2% of each successful transaction, processing fees separate", never "a small fee".
- Tone follows [voice-and-tone](../brand/voice-and-tone.md).
- The `technical-writing` skill in `.claude/skills` checks these rules.

## Links

- Link between docs with relative paths, for example `../architecture/payments.md`.
- Only link to files that exist or are in the planned tree in [docs/README.md](../README.md). A link to a planned file is allowed when the plan is recorded.
- Link to external sources with full URLs and, for vendor facts (Stripe, Better Auth), the date they were checked.

## Terminology

Use these terms consistently in docs, UI copy, and code.

| Term | Meaning | Do not use |
|------|---------|------------|
| creator | The person who owns a community | owner (in UI), admin (for the creator) |
| member | A person who belongs to a community | user (in member facing copy), subscriber (unless about billing) |
| community | The tenant. One creator's space with its own members and content | group, workspace, tenant (in UI) |
| Community, Classroom, Calendar, Members | The four member tabs, always in this order | Feed, Courses, Events, People (as tab names) |
| Manage | The creator admin area: Overview, Inbox, People, Payments, Appearance, Settings, Migration | Admin, Dashboard |
| classroom | The courses area | academy, library |
| course | A set of modules | program |
| module | A section of a course containing lessons | chapter |
| lesson | One unit of learning content | class, unit |
| event | A scheduled item in the Calendar | session, meeting (as a type) |
| membership | A member's paid or free access tier in a community | plan (alone), subscription (for this meaning) |
| subscription | The billing object at the payment provider | membership (for this meaning) |
| entitlement | What a member can access, derived from memberships and purchases | permission (for content access) |
| platform fee | The 2% Cloud Edition fee on successful transactions | commission, cut, take rate |
| processing fee | What the payment provider charges, separate from the platform fee | included fee |
| Community Edition | Self-hosted, open source, 0% platform fee | free version, lite |
| Cloud Edition | Managed by the Cohory team, no mandatory monthly subscription, 2% platform fee | pro, premium |
| agent | An AI actor with its own identity and scoped permissions | bot, AI user |

Module names in architecture docs are capitalized: Identity, Communities, Members, Posts, Comments, Courses, Lessons, Events, Gamification, Payments, Subscriptions, Entitlements, Notifications, Migration, Agent integrations.

## Diagrams

- Use Mermaid in fenced `mermaid` blocks so diagrams live in the repository and diff in review.
- Add a diagram only when it explains something faster than text: request flows, state machines (membership status, subscription lifecycle), module dependencies.
- Keep each diagram under about 15 nodes. Split larger ones.
- Label arrows with the action or event, for example `invoice.paid`.
- Every diagram has one sentence before it saying what it shows. Do not rely on color alone.
- Do not commit exported images of diagrams that can be written in Mermaid.

## Length

| Kind | Target |
|------|--------|
| Foundation and product docs | 150 to 400 lines |
| Architecture docs | 250 to 600 lines |
| Brand docs | 150 to 350 lines |
| Decision records | As short as the decision allows, usually under 150 lines |
| Root files (README, CONTRIBUTING, SECURITY, GOVERNANCE) | Under 200 lines |
| AGENTS.md | 200 to 350 lines |

Dense and useful beats long. If a doc grows past its target, split it.

## Where each kind of doc lives

| Folder | Contents |
|--------|----------|
| `docs/foundation` | Vision, mission, principles, audience, requirements, business model, roadmap |
| `docs/product` | Information architecture, journeys, feature inventory, MVP scope. Must match the UI |
| `docs/brand` | Brand strategy, voice, visual identity, design tokens |
| `docs/architecture` | How the system is built: overview, data model, payments, multi-tenancy, authorization, agent integrations |
| `docs/decisions` | Numbered decision records (`0001-short-title.md`) and their index |
| `docs/research` | Dated research that informed decisions. Not updated after the fact, only superseded |
| `docs/open-source` | Release strategy, these conventions, and other project process docs |
| `docs/operations` and `docs/self-hosting.md` | How-to guides for operators and creators: install, operate, payments, importers, API tokens, MCP, webhooks |
| `docs/security` | Threat model and dated security reviews |
| Repository root | README, AGENTS.md, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, GOVERNANCE, LICENSE |
| `.claude/skills` | Agent skills and their README |

User facing guides live in `docs/operations` and `docs/self-hosting.md`, and the API reference is served by the app at `/docs/api`. **Recommendation:** move them to a documentation site under `apps/docs` once one exists.

## Keeping docs current

- Update docs in the same PR as the code they describe.
- When a decision record changes a fact, update every doc that states that fact and link the record.
- Mark outdated docs as Deprecated with a link to their replacement instead of deleting them silently.

## Decisions and open questions

- **Confirmed:** Status line, the four labels, no dash punctuation, no emojis, relative links, canonical terms, length targets.
- **Recommendation:** Mermaid only, diagram size limit, decision record naming, user guides in `apps/docs`.
- **Open question:** when to publish the docs folder as a site.
