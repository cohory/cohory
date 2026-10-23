# Documentation index

Every doc in the Cohory repository, grouped by folder, with one line on what each covers.

Status: Draft, 2026-10-23

Writing rules are in [documentation conventions](open-source/documentation-conventions.md).

## Foundation

| Doc | What it covers |
|-----|----------------|
| [vision.md](foundation/vision.md) | Long-term direction: what we are building, for whom, and what we refuse to become |
| [mission.md](foundation/mission.md) | What Cohory exists to do and the first-year commitments |
| [principles.md](foundation/principles.md) | The eleven rules for product and engineering trade-offs |
| [target-audience.md](foundation/target-audience.md) | Audience segments, personas, and the alternatives they use today |
| [product-requirements.md](foundation/product-requirements.md) | Functional and non-functional requirements by module |
| [business-model.md](foundation/business-model.md) | Editions, the 2% platform fee, and fee rules |
| [roadmap.md](foundation/roadmap.md) | Phases 0 to 7 with scope, dependencies, and acceptance criteria |

## Product

| Doc | What it covers |
|-----|----------------|
| [information-architecture.md](product/information-architecture.md) | Screens, URLs, the four member tabs, and Manage |
| [user-journeys.md](product/user-journeys.md) | End-to-end journeys for creators, members, and agents |
| [feature-inventory.md](product/feature-inventory.md) | Every feature by module and phase, with its build status |
| [mvp-scope.md](product/mvp-scope.md) | What is in and out of the MVP and how it is verified |
| [decisions-log.md](product/decisions-log.md) | Every resolved product and engineering question, with who decided it and where it is implemented |
| [backlog.md](product/backlog.md) | Open and deferred items, grouped by area, with the human gates they wait on |

## Brand

| Doc | What it covers |
|-----|----------------|
| [brand-strategy.md](brand/brand-strategy.md) | Positioning, messaging, homepage copy, naming directions |
| [voice-and-tone.md](brand/voice-and-tone.md) | How Cohory sounds, with plain-language rules |
| [visual-identity.md](brand/visual-identity.md) | Logo direction, color, type, layout, dark mode, creator customization |
| [design-tokens.md](brand/design-tokens.md) | Token specification for Tailwind CSS and shadcn/ui, component behavior |

## Architecture

| Doc | What it covers |
|-----|----------------|
| [overview.md](architecture/overview.md) | The modular monolith, modules, boundaries, and repository layout |
| [data-model.md](architecture/data-model.md) | Tables, relationships, and ownership per module |
| [payments.md](architecture/payments.md) | Stripe Connect direct charges, fees, webhooks, offboarding |
| [multi-tenancy.md](architecture/multi-tenancy.md) | Tenant isolation and `community_id` scoping |
| [authorization.md](architecture/authorization.md) | Roles, permissions, and entitlements checks |
| [agent-integrations.md](architecture/agent-integrations.md) | REST API, MCP, agent identities, scopes, and audit logs |
| [archive-format.md](architecture/archive-format.md) | The versioned community archive that moves a community between servers |
| [agent-course-format.md](architecture/agent-course-format.md) | The agent layer on lessons, its storage and versions, and the Agent Skills export |
| [evaluation-runner.md](architecture/evaluation-runner.md) | How an agent runs course tasks and evaluations in its own environment and reports results |

## Security

| Doc | What it covers |
|-----|----------------|
| [threat-model.md](security/threat-model.md) | Assets, actors, trust boundaries, STRIDE per boundary, and the controls that exist with file references |
| [review-2026-10.md](security/review-2026-10.md) | Internal review checklist with evidence, findings by severity, and what is deferred to an external review |
| [review-agent-courses.md](security/review-agent-courses.md) | Review of downloaded skills and external course content for agent ready courses |

## Self-hosting and operations

| Doc | What it covers |
|-----|----------------|
| [self-hosting.md](self-hosting.md) | Index and reference: services, volumes, database roles, backups, upgrades, rate and fair use limits, reverse proxy |
| [operations/install.md](operations/install.md) | A clean server to a working community with the production overlay and HTTPS |
| [operations/operator-guide.md](operations/operator-guide.md) | Configuration, logs, backups and restores, upgrades, limits, rotating secrets |
| [operations/load-test.md](operations/load-test.md) | The k6 load test, measured p95 latencies, and the gap to REQ-NFR-PERF-005 |
| [operations/payment-migration.md](operations/payment-migration.md) | Moving paying members to cohory: link existing Stripe subscriptions, Stripe account copy, or subscribe again, with the limits of each |
| [operations/payment-providers.md](operations/payment-providers.md) | Connecting Stripe Connect, your own Stripe keys, or Polar, what each provider supports, and how the platform fee is collected or billed |
| [operations/platform-billing.md](operations/platform-billing.md) | Monthly platform fee invoices on Cloud for providers that cannot collect the fee at charge time |
| [operations/offboarding.md](operations/offboarding.md) | Moving a community from Cloud to your own server |
| [operations/importers/skool.md](operations/importers/skool.md) and [circle.md](operations/importers/circle.md) | What the Skool and Circle importers bring over and what stays behind |
| [operations/api-tokens.md](operations/api-tokens.md) | API tokens, agent identities, scopes, and approvals |
| [operations/mcp.md](operations/mcp.md) | Connecting AI assistants through the MCP server with OAuth or an agent token |
| [operations/webhooks.md](operations/webhooks.md) | Outbound webhooks and how a receiver verifies them |
| [operations/agent-courses.md](operations/agent-courses.md) | Preparing a course for agents and exporting it as an Agent Skills folder |
| [operations/agent-courses-delegation.md](operations/agent-courses-delegation.md) | Agent access to courses, delegation by members, and purchases agents propose |

## Decisions

| Doc | What it covers |
|-----|----------------|
| [decisions/README.md](decisions/README.md) | How decision records work, the template, and the index of every record with its status |

## Research

| Doc | What it covers |
|-----|----------------|
| [comparable-projects.md](research/comparable-projects.md) | Ten comparable open-source projects, their stacks, licenses, and lessons for Cohory |

## Open source

| Doc | What it covers |
|-----|----------------|
| [local-workflow.md](open-source/local-workflow.md) | What runs where while working, the loop for one task, test slots, and the development stack |
| [testing.md](open-source/testing.md) | Every test suite, what it needs, and how to run it |
| [release-strategy.md](open-source/release-strategy.md) | Versioning, cadence, changelog, image tags, deprecation, security releases |
| [documentation-conventions.md](open-source/documentation-conventions.md) | Writing rules, labels, terminology, diagrams, and where docs live |

## Repository root

| File | What it covers |
|------|----------------|
| [README.md](../README.md) | Project overview, editions, status, and documentation map |
| [AGENTS.md](../AGENTS.md) | Operating manual for coding agents |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to propose changes, conventions, PR checklist |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Code of conduct based on the Contributor Covenant 2.1 |
| [SECURITY.md](../SECURITY.md) | Private vulnerability reporting and response targets |
| [GOVERNANCE.md](../GOVERNANCE.md) | Maintainer model and how decisions are made |
| [LICENSE](../LICENSE) and [LICENSING.md](../LICENSING.md) | AGPL-3.0 text, and which parts are MIT |
| [CHANGELOG.md](../CHANGELOG.md) | What the current version contains and what changed since |
| [.claude/skills/README.md](../.claude/skills/README.md) | Agent skills and the recommended workflow chain |

## Decisions and open questions

- **Recommendation:** this index is updated in the same PR that adds, renames, or removes a doc.
