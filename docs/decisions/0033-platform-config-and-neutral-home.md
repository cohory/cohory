# 0033. One platform config, a neutral edition aware home, and instance branding

The edition, the app URL, and the instance's name and logo are parsed once in `packages/config`. The app's `/` is a neutral page that names the instance and carries no sales copy or fee numbers; the Cloud marketing site lives outside this repository.

Status: Accepted, 2026-10-22. Superseded in part by [0047](0047-cloud-marketing-in-the-app.md)

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: founder (Cloud home: marketing site separate, app `/` neutral and edition aware), coordinator as product owner for the details
- Related: [0027](0027-safe-exit-and-2-percent-fee.md), [../architecture/overview.md](../architecture/overview.md) sections 10 and 11, [../product/information-architecture.md](../product/information-architecture.md) section 2, [../self-hosting.md](../self-hosting.md)

## Context

The signed out home said "pay just 2% in platform fees" on every server, including self-hosted ones that charge nothing (platform review, 2026-10-21). A creator who pressed "Create account" landed on an empty My communities list and had to find Create a community again. A member with one community had to click its card on every visit. A self-hosted operator could not name their site: the header, page titles, and sign in text all said "Cohory", and could not open `/` on their own community.

The code review found the app URL worked out in eight places with different fallbacks, two of them reading `process.env` without Zod, and the edition parsed twice and typed three times, while the overview says `COHORY_EDITION` is read once in `packages/config`.

The founder decided that the Cloud marketing site is a separate site, and that the app's `/` becomes a neutral, edition aware page: sign in, My communities, operator branding on self-hosted servers, and a link to the marketing site on Cloud from config, hidden when unset. No Cloud sales copy and no hardcoded fee numbers in `apps/web`.

## Decision

1. **One parse.** `@cohory/config/platform` exports `parsePlatformEnv(env)` and a cached `getPlatformConfig()` returning `{ edition, appUrl, instance: { name, logoUrl }, marketingUrl, homeCommunity }`, all validated with Zod. `parseEdition(env)` and `parseAppUrl(env)` serve packages that parse their own variables and inject an env in tests. `appUrl` is `APP_URL`, else `BETTER_AUTH_URL`, else `http://localhost:3000`, with trailing slashes removed and any path kept. `@cohory/config/edition` exports the `Edition` type with no runtime code, so client components can import it.
2. **Call sites.** Courses, calendar, OAuth metadata, MCP, migration, the worker, the web app's `appUrl()`, and fair use use the shared parsers. The `Edition` type in `packages/ui` fee copy, fair use, and migration import comes from config. Payments keeps its own parse for now because another change to that package is in flight; it moves in a follow up.
3. **Instance branding.** `INSTANCE_NAME` (at most 60 characters, default "Cohory") and `INSTANCE_LOGO_URL` replace the hard coded name in the platform bar, the root title template, the sign in and forgot password text, the 404 header, OAuth consent, API tokens, cancel deletion, webhooks, and migration pages. The logo must be a root relative path or a URL on the `APP_URL` origin, because the content security policy allows images only from the app's own origin; other values fail at startup with a message naming the variable. Email templates use the same helper in a separate change.
4. **Neutral home.** Signed out, `/` shows "Welcome to {instance name}", "Sign in to see your communities, or create your own.", and one button, Create your community, linking to `/sign-up?next=/communities/new`. Sign in stays in the platform bar only. On the Cloud Edition, "Learn more about {instance name}" links to `MARKETING_URL` when it is set; the link never shows on the Community Edition. The page names no fee.
5. **Creator intent.** Sign up with `next=/communities/new` says "Create your account, then name your community." and returns to the create form.
6. **Direct landing.** A signed in person with exactly one community is redirected from `/` to `/c/{slug}`. `/?home=1` always shows My communities, and the Home item in the avatar menu links there.
7. **Operator home.** `HOME_COMMUNITY={slug}` redirects signed out visitors from `/` to `/c/{slug}/about`. Signed in people still get their own home.
8. **Runtime dependency.** `@cohory/config` gains `zod` as its only runtime dependency. Its lint presets move to dev dependencies so production installs do not pull ESLint.

The decision is a pure function, `homeDestination`, with unit tests; the parsers have unit tests for defaults, blanks, and every rejected value.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep the marketing page at `/` on Cloud and hide it on self-hosted | One site to run | Sales copy and fee numbers in the AGPL app, edition checks in page copy | The founder chose a separate marketing site |
| Show "No platform fee" on the Community Edition home | Correct on both editions | Still a pricing claim on an operator's front page | A neutral page needs no pricing |
| Allow a logo from any HTTPS host and add its origin to the content security policy | Operators can use a CDN | Widens `img-src` from config, more surface for a small gain | A same origin path covers the need; revisit if operators ask |
| A new `packages/platform-config` package | No change to the tooling package | One more package for five values; the overview already names `packages/config` | Followed the overview |
| Redirect one community members with a cookie that remembers "show home" | No query parameter | Hidden state, harder to link | `?home=1` is explicit and linkable |

## Consequences

- Positive: self-hosted front pages no longer show false pricing, operators see their own name and logo, and a creator goes from the home page to the create form in one flow.
- Positive: one place decides the app URL and the edition, with the same fallback and validation everywhere.
- Negative: an invalid `INSTANCE_LOGO_URL`, `MARKETING_URL`, `HOME_COMMUNITY`, or `INSTANCE_NAME` fails the first request that reads the config instead of being ignored.
- Negative: people with one community reach My communities only through Home in the avatar menu.
- Follow up: payments moves to `parseEdition` and `parseAppUrl`, and the payments copy that says "the Cohory fee" moves to the instance name. Archive and API texts that name the software ("a Cohory archive", the MCP notices) keep the product name on purpose.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Marketing site separate; app `/` neutral and edition aware; no Cloud sales copy or fee numbers in `apps/web` (founder, 2026-10-22). |
| Recommendation | Same origin logos only; `?home=1` as the way back to My communities. |
| Open question | Whether `HOME_COMMUNITY` should also apply to signed in people who are not members of it. |
