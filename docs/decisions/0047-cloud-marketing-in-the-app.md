# 0047. Cloud marketing pages in the app, shown only on the Cloud Edition

The Cloud Edition's signed out `/`, `/pricing`, and `/open-source` are marketing pages built in `apps/web`. The Community Edition keeps the neutral home from [0033](0033-platform-config-and-neutral-home.md) and has none of these pages. `MARKETING_URL` is removed.

- ADR status: Accepted
- Date: 2026-10-23
- Deciders: founder (cohory.org serves the marketing pages and the app from `apps/web`), coordinator as product owner for the details
- Supersedes: [0033](0033-platform-config-and-neutral-home.md) in part (the separate marketing site, the "Learn more" link, `MARKETING_URL`, and "no Cloud sales copy in `apps/web`")
- Related: [0027](0027-safe-exit-and-2-percent-fee.md), [0009](0009-license.md), [../product/information-architecture.md](../product/information-architecture.md) section 2, [../brand/voice-and-tone.md](../brand/voice-and-tone.md)

## Context

[0033](0033-platform-config-and-neutral-home.md) made `/` a neutral page on every edition and put the Cloud marketing site outside this repository, reached through a "Learn more" link set by `MARKETING_URL`. Platform review 13 ("A real creator landing on Cloud") found that a creator who opens Cloud sees one headline and an empty screen: no outcome, no pricing, and nothing about the open source difference. On 2026-10-23 the founder decided that cohory.org serves both the marketing pages and the app from `apps/web`, with no separate site and no app subdomain.

## Decision

1. **Edition gate.** `hasMarketingPages(edition)` in `apps/web/lib/marketing/edition.ts` is true only on the Cloud Edition. `/pricing` and `/open-source` call it and answer 404 on the Community Edition. `homeDestination` returns `landing` for a signed out visitor on Cloud when `HOME_COMMUNITY` is unset; `HOME_COMMUNITY` still wins, and signed in people keep their own home (one community opens it, otherwise My communities).
2. **Pages.** Cloud `/` signed out: a hero with Create your community (to `/sign-up?next=/communities/new`) and "No credit card required.", then What you get (feed, courses, events, paid memberships, AI agents), How it works in 3 steps, Pricing, the open source block, Questions, and a closing button. `/pricing`: one plan, free to start, the platform fee, fair use limits per community, and a comparison with the Community Edition. `/open-source`: what the Community Edition is, the license (AGPL core, MIT SDK, generated client, and agent runner), how to move to your own server, and Get the source code when `SOURCE_URL` is set.
3. **Numbers come from config.** The fee is `parsePaymentsEnv().platformFeeBps` formatted by `formatFeeRate` and `platformFeeLine` from `@cohory/ui`, the same source the payments screens and Creator Terms use; no page hard codes a rate. The limits come from `parseFairUseEnv()` (`FAIR_USE_*`), and the paid tier window from `paidTierWindowDays`. `loadCloudPricing()` in `apps/web/lib/marketing/pricing.ts` builds both.
4. **Shell.** The marketing pages share one header (logo, Pricing, Open source, Sign in, Create your community; My communities when signed in) and the existing footer. They are server components with no client JavaScript. Each page sets its title, description, canonical URL, and Open Graph fields, and `sitemap.xml` lists `/pricing` and `/open-source` only on Cloud.
5. **Simplification.** `MARKETING_URL`, the `marketingUrl` config field, and the "Learn more about {instance name}" link are removed. A leftover `MARKETING_URL` in an `.env` is ignored.

The gate, the destination, the sitemap, and the pricing values have unit tests; `apps/e2e/tests/cloud-marketing.spec.ts` checks both editions at desktop and phone widths.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A separate marketing site and the app on a subdomain (0033) | Sales copy outside the AGPL app | A second site to build, host, and keep in sync with prices and features | Founder decision of 2026-10-23 |
| A separate `apps/www` in this repository | Clear split | A second Next.js app, build, and deploy for three pages | Three server rendered pages fit in `apps/web` |
| Marketing pages on both editions | One code path | Cloud pricing on an operator's server is false | Self-hosted servers keep the neutral home |
| Hard coded fee and limits in the copy | Simple | Wrong the day the config changes | AGENTS.md section 7 keeps the fee in the fee module and its config |

## Consequences

- Positive: a creator who opens Cloud sees what they get, what it costs, and that they can leave, with one button to start.
- Positive: prices and limits on the pages always match what the server enforces.
- Negative: Cloud sales copy now lives in the AGPL app and has to follow feature changes; the copy names only built features.
- Negative: the self-hosting guide is named as a file in the source (`docs/self-hosting.md`) because there is no public docs site yet.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Marketing pages and the app in `apps/web` on cohory.org; no `apps/www` (founder, 2026-10-23). |
| Recommendation | Pages: `/`, `/pricing`, `/open-source`. The Create your community button is hidden in the header on phones because the hero carries it. |
| Open question | A public docs site to link instead of naming files in the source. |
