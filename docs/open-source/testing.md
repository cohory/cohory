# Testing

How Cohory is tested: which suites exist, what each one needs, and how to run them on a developer machine and in CI.

Status: Draft, 2026-10-23

## Suites

| Suite | Command | Needs | Runs in CI |
|-------|---------|-------|------------|
| Unit | `pnpm test` | Node only | `CI` workflow, job Check |
| Coverage floors | `pnpm test:coverage` | Node only | `CI` workflow, job Check |
| Integration | `pnpm test:integration:local` (or `pnpm test:integration` with your own `DATABASE_URL`) | Docker for the shared test services stack, or any throwaway PostgreSQL 17 | `CI` workflow, job Integration |
| End to end | `pnpm e2e` | Docker with the Compose plugin, Node, pnpm | `E2E` workflow, job Playwright on Compose |
| End to end on the host | `pnpm e2e:host <specs>` | Docker for the shared test services stack, Node, pnpm | No |
| Upgrade path | `scripts/upgrade-check.sh` | Docker with the Compose plugin, Node, pnpm | `E2E` workflow, job Upgrade path |

Unit and integration tests use Vitest. End to end tests use Playwright (AGENTS.md section 4).

### Coverage floors

`pnpm test:coverage` runs the unit tests of `@cohory/authz`, `@cohory/payments`, and `@cohory/entitlements` with the v8 coverage provider and fails when a file drops below its floor. The floors live in `packages/config/vitest.js`, keyed by package, and sit just under the coverage measured on 2026-10-22:

| Package | Files | Statements, branches, functions, lines (%) |
|---------|-------|---------------------------------------------|
| `@cohory/authz` | `src/**` | 90, 85, 80, 90 |
| `@cohory/payments` | `src/fee.ts` | 100, 85, 100, 100 |
| `@cohory/payments` | `src/access.ts` (membership sync) | 95, 95, 85, 95 |
| `@cohory/entitlements` | `src/access.ts` | 75, 75, 75, 75 |
| `@cohory/entitlements` | `src/community-access/membership-access.ts` (the paid access rule, [0031](../decisions/0031-community-access-module.md)) | 95, 95, 85, 95 |

The entitlements floor is low because part of `access.ts` is covered only by the integration tests. Raise a floor when tests add coverage; lower one only with a reason in the PR. The `CI` workflow runs `pnpm test:coverage` in job Check on every pull request and push to `main`.

### Required tests

- Every resource in the permission matrix (`packages/authz/src/matrix.ts`) has a per role table test in `policy.test.ts` with at least one denied case. The test loops over every resource, so a new resource without a table fails it.
- Auth integration tests cover sign up, sign in, sign out (the cookie is cleared and the session row deleted), an expired session (refused), password reset, and password change. Each `describe` creates its own user, so any test runs alone with `-t`. Account linking has no tests because there is no OAuth sign in provider yet.
- The MCP registry test lists each tool's required scope and destructive hint explicitly. The snapshot holds only the tool shape (name, operation, action, inputs), so a scope change cannot slip through a snapshot update.

## On a developer machine

The day to day loop (which command when, and the test slots) is in [local workflow](local-workflow.md).

The suites are sized for an 8 core laptop with Docker Desktop. **Recommendation:** give Docker Desktop 6 CPUs and 6 GB of memory (Settings, Resources). Nothing checks this; it is what the numbers below were measured with in mind.

### Changed packages only, or everything

| Command | Runs | Who |
|---------|------|-----|
| `pnpm verify:changed` | Typecheck, lint, and unit tests for packages changed since `main` and every package that depends on them, Prettier on the changed files, then their integration tests | A contributor or agent while working on a branch |
| `pnpm verify` | Typecheck, lint, unit tests, and build for every package, Prettier on the whole tree, then every integration test | Whoever lands the branch, before merging |
| `pnpm e2e:host <specs>` | The specs a change touches, on the host (below) | A contributor or agent after `pnpm verify:changed` |
| `pnpm e2e` | The end to end suite (below) | After `pnpm verify`, before landing a batch that touches the app |

`VERIFY_BASE` sets another base branch for `pnpm verify:changed`, and `VERIFY_SKIP_INTEGRATION=1` skips its integration step. A change to root config (`turbo.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `eslint.config.js`, `.prettierrc`, `.nvmrc`) checks every package. Both scripts first run `scripts/turbo-cache-clean.sh`.

### Caching

Turborepo replays a task whose inputs did not change, so a rerun with no change takes seconds and `--force` is never needed. Packages export their TypeScript sources, so a package's results also depend on the sources of the packages it imports. Every `typecheck`, `lint`, `test`, `test:integration`, and `build` task depends on a `transit` task that has no script and depends on `^transit`, which puts the files of all workspace dependencies into the hash (the [transit node pattern](https://turborepo.com/docs/crafting-your-repository/configuring-tasks)). Changing `packages/db` reruns every package that imports it and replays the rest. Integration results are cached too, keyed by the sources and the test Postgres image in `docker/testinfra.compose.yml`. `DATABASE_URL` reaches the tests but is not part of the key, because each checkout tests on its own fresh database with a different name. Root files that one package reads in its tests are inputs of that package only: `assets/brand/colors.json` for `@cohory/ui` and `docs/operations/mcp.md` for `@cohory/mcp`. The `check` task runs the SDK drift check.

Worktrees share the cache of the main checkout (`.turbo/cache`). `scripts/turbo-cache-clean.sh` (`pnpm cache:clean`) deletes entries older than `TURBO_CACHE_MAX_AGE_DAYS` (default 3), then the oldest entries until the cache fits `TURBO_CACHE_MAX_MB` (default 3072). A cached web build is 300 to 700 MB.

### Parallelism

`pnpm verify`, `pnpm verify:changed`, and `pnpm test:integration:local` run at most 2 packages at a time (`VERIFY_CONCURRENCY`, `INTEGRATION_CONCURRENCY`), the root `typecheck` and `lint` scripts at most 4 and `test` and `test:integration` at most 3 (`--concurrency`), and each Vitest run uses at most 2 workers (`testDefaults` in `packages/config/vitest.js`, imported by every `vitest.config.ts`). `VITEST_MAX_WORKERS` overrides the worker count for one run. Without these caps Turbo ran 10 packages at once with one Vitest worker per core each, and the load average passed 100.

### Shared test services

Integration tests run against one long lived Compose project, `cohory-testinfra` (`docker/testinfra.compose.yml`): PostgreSQL 17 on `127.0.0.1:55432` with durability turned off for speed. It holds only test databases and never touches the development stack (project `cohory`, port 5433) or its volumes.

```sh
pnpm testinfra:up              # start it, or do nothing if it runs
pnpm test:integration:local    # all packages
pnpm test:integration:local --filter=@cohory/posts
pnpm testinfra:down            # stop it and delete its volume
```

`scripts/test-integration.sh` (behind `pnpm test:integration:local`) starts the stack if needed, creates a database named after the checkout (`cohory_test_<folder>_<hash of the path>`), points `DATABASE_URL` and `DATABASE_ADMIN_URL` at it, runs the tests, and drops the database at the end (`TESTINFRA_KEEP_DB=1` keeps it). It takes one test slot, and holds the lock `/tmp/cohory-integration.lock` while it runs, because the tests create cluster wide roles and two runs on one cluster would race.

The integration global setup (`@cohory/db/test-global-setup`, shared by every package) creates the database in `DATABASE_ADMIN_URL` when it is missing, applies the migrations, and refuses a local database on port 5433, which is the development database. CI, where port 5433 is a throwaway service container, sets `CI=true` and is allowed; `COHORY_TEST_ALLOW_DEV_DB=1` allows it on purpose. Tests never read the root `.env`.

### Test slots

Every heavy entry point takes slots from one machine wide pool of `COHORY_TEST_SLOTS` slots (default 2) in `/tmp/cohory-slots` (`scripts/lib/slots.sh`): `pnpm verify`, `pnpm verify:changed`, and `pnpm test:integration:local` take one, `pnpm e2e`, `pnpm e2e:host`, and `scripts/upgrade-check.sh` take all of them, so two e2e stacks never run at once and nothing else heavy runs next to one. A waiting run prints one line naming the holders; waiters are served in arrival order. A slot whose process is gone is taken over, and a slot handed to pid 0 is taken over after 4 hours (`COHORY_LOCK_STALE_MINUTES`). `scripts/e2e-up.sh` on its own takes every slot until `scripts/e2e-down.sh` releases them. See [local workflow](local-workflow.md#test-slots).

## End to end suite

The suite lives in `apps/e2e` (package `@cohory/e2e`). It sits under `apps/` because it is a runnable consumer of the built app, like `apps/web` and `apps/worker`, and the existing `apps/*` workspace glob picks it up without changes to `pnpm-workspace.yaml`. It has no build step and never ships in the image.

### Run it

```sh
pnpm install
pnpm --filter @cohory/e2e exec playwright install chromium
pnpm e2e
```

`pnpm e2e` runs `scripts/e2e-run.sh`, which:

1. Takes every test slot, then runs `scripts/e2e-up.sh`: builds the image as `cohory:e2e-<hash>` unless an image with that tag exists, starts an isolated Compose project named `cohorye2e` with web on `http://localhost:3310`, a second web container in Community Edition on `http://localhost:3311`, a third in Cloud with community creation limited to `E2E_BETA_OPERATOR_EMAIL` (the Cloud beta of ADR 0050) on `http://localhost:3315`, a fake Stripe API on `127.0.0.1:3312`, a fake Polar API on `127.0.0.1:3313`, a webhook receiver on `127.0.0.1:3314` (the app may send to it through `EGRESS_ALLOW_PRIVATE_HOSTS=webhook-receiver`; tests read what it got from `/__deliveries`), and PostgreSQL on `127.0.0.1:55310`, waits for them to answer, and runs `pnpm db:seed` against that database.
2. Runs `playwright test` in `apps/e2e`. Extra arguments pass through, for example `pnpm e2e --project=desktop` or `pnpm e2e journey-08`.
3. Always runs `scripts/e2e-down.sh`, which removes the project with its volumes (`down -v --remove-orphans`), prunes dangling images, and trims the build cache to `BUILD_CACHE_MAX` (`docker builder prune -f --max-used-space 3gb`), then releases the slots.
4. Exits with the Playwright exit code.

The image tag is a hash of every file that can change the image: the Dockerfile, the lockfile and workspace manifests, `turbo.json`, `apps/web`, `apps/worker`, and `packages`, without unit and integration test files. A branch that changes only specs, docs, or scripts reuses the image another run built. The Dockerfile keeps the pnpm store and the Turbopack build cache (`apps/web/.next/cache`) in BuildKit cache mounts, so a rebuild after a code change skips the download and recompiles only what changed. Pruning the whole build cache (`docker builder prune -f` without a limit) throws both away; cap it instead. After a build the script removes hashed e2e images beyond the newest `E2E_KEEP_IMAGES`. Volumes are never pruned.

The e2e stack never touches the default `cohory` project, its volumes, or port 5433, so it can run next to a development stack.

| Variable | Default | Effect |
|----------|---------|--------|
| `APP_PORT` | `3310` | Host port of the web app |
| `E2E_COMMUNITY_PORT` | `3311` | Host port of the Community Edition web container |
| `E2E_BETA_PORT` | `3315` | Host port of the Cloud beta web container, where only `E2E_BETA_OPERATOR_EMAIL` (default `beta-operator@e2e.example.test`) may create communities |
| `E2E_FAKE_STRIPE_PORT` | `3312` | Host port of the fake Stripe API (bound to `127.0.0.1`) |
| `E2E_STRIPE_WEBHOOK_SECRET` | `whsec_e2e_only_not_a_real_secret` | Webhook signing secret shared by the stack and the specs |
| `POSTGRES_HOST_PORT` | `127.0.0.1:55310` | Host binding of PostgreSQL |
| `COMPOSE_PROJECT_NAME` | `cohorye2e` | Compose project, so containers and volumes stay separate |
| `COHORY_VERSION` | `e2e-<hash of the image inputs>` | Image tag. An image with the hashed tag is reused without a build. CI sets `e2e` |
| `E2E_SKIP_BUILD` | unset | `1` reuses an existing `${COHORY_IMAGE}:${COHORY_VERSION}` image whatever its tag (CI builds it once beforehand) |
| `E2E_KEEP_IMAGES` | `2` | Hashed e2e images kept after a build |
| `BUILD_CACHE_MAX` | `3gb` | Build cache size `scripts/e2e-down.sh` trims to |
| `COHORY_TEST_SLOTS` | `2` | Size of the machine wide test slot pool; an e2e run takes every slot |
| `E2E_KEEP_STACK` | unset | `1` leaves the stack running after the tests |
| `E2E_WORKERS` | `3` | Playwright workers |

The stack runs with `COHORY_EDITION=cloud`, `PLATFORM_FEE_BPS=200`, a test mode Stripe key, `EMAIL_DRIVER=log`, and `RATE_LIMIT_DISABLED=true` (set in `apps/e2e/compose.e2e.yml`). Only `web` sets `COHORY_ENABLE_POLAR=true`, so the Polar journey keeps running there while `web-community` checks that Polar is not offered by default. The `web-community` service runs the same image on the same database with `COHORY_EDITION=community`, so one run covers both editions' payments copy. The public URL comes from `APP_URL` and `BETTER_AUTH_URL` at runtime, so `web` and `web-community` run the same image on two origins (`http://localhost:3310` and `http://localhost:3311`).

### On the host

`pnpm e2e:host <specs>` (`scripts/e2e-host.sh`) runs the same specs without the Docker image, for the inner loop. It takes every test slot, replays the web and worker build from the turbo cache (building only what changed), creates a fresh database `<checkout database>_e2e` on the shared test services stack (`127.0.0.1:55432`), migrates and seeds it, and starts on the host: the fake Stripe (3312), fake Polar (3313), and webhook receiver (3314) as plain Node processes, `next start` on 3310 (Cloud, Polar on), on 3311 (Community Edition), and on 3315 (Cloud beta, `COMMUNITY_CREATION=operators`), and the worker from `apps/worker/dist`. The environment is the one in `apps/e2e/compose.e2e.yml` with host addresses (`EGRESS_ALLOW_PRIVATE_HOSTS=127.0.0.1`), and like Compose the app also reads the root `.env` for anything not set there. Playwright runs with 2 workers (`E2E_WORKERS`) and the desktop project only, unless `E2E_MOBILE=1` or a `--project` argument is given. The specs reach the database with `psql` in the test services container, read worker logs from files (`E2E_LOG_DIR`), give the app the receiver address from `E2E_WEBHOOK_RECEIVER_APP_URL`, and give the fake Polar server the app address from `E2E_POLAR_APP_URL`. At the end it stops only the processes it started, drops the database, and on a failure copies the service logs to `apps/e2e/test-results/host-logs`. It refuses to start when one of the ports 3310 to 3315 is taken.

`pnpm e2e` stays the gate before landing and the release check, because only it runs the production image.

### Payments without Stripe

The payments spec never talks to Stripe. `apps/e2e/support/fake-stripe/server.mts` is a small Node server that answers the calls the payments gateway makes (Accounts v2, account links, products and product renames, prices, Checkout sessions with their open list and expiry, portal sessions, reads of subscriptions, invoices, charges, and application fees, and the list of a subscription's paid invoices) and records each call with its connected account and idempotency key. Compose runs it as the `fake-stripe` service from the app image with Node type stripping, and web and worker reach it through `STRIPE_API_BASE_URL=http://fake-stripe:12111`. It runs inside the Compose network rather than on the host, so it works the same on Docker Desktop and on Linux CI.

The spec drives it through two control routes on the published port: `GET /__control/calls?account=` to assert what the app sent, and `POST /__control/objects` to seed the subscription, invoice, charge, and application fee that a webhook handler fetches. Webhook events are signed with `Stripe.webhooks.generateTestHeaderString` and the stack's `STRIPE_WEBHOOK_SECRET`, then posted to `/api/webhooks/stripe`. Browser navigations to the Stripe hosted pages (`connect.stripe.test`, `checkout.stripe.test`, `billing.stripe.test`) are answered by a Playwright route, so the spec asserts the redirect target without leaving the machine. A run against real Stripe test mode is still a manual check before a release.

To work on a spec, start the stack once and keep it:

```sh
bash scripts/e2e-up.sh
pnpm --filter @cohory/e2e exec playwright test journey-05
pnpm e2e:ui
bash scripts/e2e-down.sh
```

### What it covers

`apps/e2e/tests` holds 49 spec files. The `journey-*` specs follow [user-journeys](../product/user-journeys.md), and each is one test whose steps show up in the report. The other specs are named after the area they check (`safe-exit-*`, `legal-pages`, `email-opt-out`, `slug-change`, `manage-structure`, `paid-leave-rejoin`) or the build step that added them (`step10-*` to `step18-*`: joining, moderation, archive, importers, providers, agents, approvals, webhooks, MCP, OAuth, agent courses, the About page, reviews, theme, and cover). The table lists the journey specs and the oldest area specs.

| Spec | Journey | Projects |
|------|---------|----------|
| `journey-01-create-community` | 1. Sign up through the form, create a public community, four sections and Manage, owner listed as Creator | desktop |
| `journey-03-join-free-community` | 3. Sign up, join a public community, private community shows only About, Manage refused | desktop, mobile |
| `journey-05-post-and-comment` | 5. Post with bold text, video link, and image, comment, like, notification bell, reply | desktop, mobile |
| `journey-06-resume-course` | 6. Course at 0%, Start, Mark complete, Continue learning on the community home, 100% | desktop, mobile |
| `journey-07-create-course` | 7. Create a course, markdown lesson with PDF, video lesson, publish, keyboard reorder, sanitized content | desktop |
| `journey-08-schedule-event` | 8. Weekly event at 18:00 Europe/Berlin across the next daylight saving change, RSVP, ics with RRULE and EXDATE, cancel one week | desktop, mobile |
| `journey-09-points-and-leaderboard` | 9. Likes give points, level badge, leaderboard 7 days and all time, unlike, points turned off | desktop |
| `journey-11-members-export` | 11. Members CSV download, documented columns, tenant scoped, refused for members | desktop |
| `manage-appearance` | Manage, Appearance: theme, font, card style, accent reach members, invalid hex refused, reset | desktop |
| `manage-invites` | Manage, People: invite link, join through it, revoke | desktop |
| `seed` | The seeded owner signs in and sees Cohory Creators with its categories, pinned welcome and Roadmap posts, and course; a visitor sees its private About page with cover, gallery, and Request to join; Cohory Pro shows its price on the About page and its invite link opens | desktop |
| `cloud-marketing` | The Cloud landing, `/pricing` (fee from `PLATFORM_FEE_BPS`, fair use table, Community Edition comparison), and `/open-source` at 1280 and 390 wide with axe; a signed in person keeps My communities; the Cloud sitemap lists both pages; the Community Edition shows the neutral home and answers 404 on both pages | desktop (each page also runs with a 390 wide actor) |
| `payments` | 2, 4, and 10. Connect Stripe, save $29 a month and $290 a year, "Join for $29.00/month" for a visitor, invite to a paid community answers 402 and lands on Membership, yearly Checkout redirect with a 2% application fee, signed webhooks (wrong signature refused, duplicate delivery) make the buyer a member with "You're in" and the renewal date, Paid members and a 2% fee in the ledger, Paid members at 390 wide, past due banner with access kept, canceled removes access. A second test checks the Community Edition copy (own keys, no platform fee) | desktop, mobile (edition check desktop only) |

The `mobile` project uses a 390 by 844 viewport with touch for the member journeys 3, 4, 5, 6, 8, and 10. In those specs the creator works at desktop size and the member at phone size.

Every spec signs up its own people with unique emails, so specs run in parallel and in any order on one database. Journeys 1 and 3 sign up through the form; other people are created through the Better Auth sign up endpoint, which is the same call the form makes. The seed users are used only by the `seed` spec, because specs that changed the shared Cohories community would depend on each other. The seed spec only reads.

### Accessibility

`expectAccessible(page)` in `apps/e2e/support/axe.ts` runs axe on every page a spec visits and fails on any serious or critical violation. Moderate and minor violations do not fail the test; each one is added as a test annotation, so it shows in the HTML report. The file keeps a list for known app defects, reported as test annotations instead of failures, each with the reason. The list is empty: the three entries it had (account menu trigger name, notifications popover name, calendar day button names) were fixed in the app. Add an entry only with an open item, and remove it when the app is fixed.

### Failures and flakes

Screenshots are kept only for failed tests. Traces are recorded on the first retry; CI retries once, local runs do not retry, so a local failure is never hidden. CI also sets `failOnFlakyTests`, so a test that fails and then passes on the retry fails the job instead of passing silently. The HTML report is in `apps/e2e/playwright-report` (`pnpm --filter @cohory/e2e e2e:report`). When a run fails, `scripts/e2e-run.sh` writes the Compose logs to `apps/e2e/test-results/compose.log`.

Rules that keep the suite stable:

- Wait for state, never for time. Use web-first assertions (`toHaveAttribute`, `toHaveURL`) and `expect(...).toPass()` for values the worker updates in the background (points, notifications).
- Before typing into a form or clicking a client side control, call `settle(page)` from `apps/e2e/pages/feed.ts`. It waits until React has hydrated every button, field, and select on the page, and fails after 30 seconds instead of carrying on. Input typed before hydration is lost, and no web-first assertion can see that. Wait for the request to finish before reloading. A reload while the request is in flight cancels it.
- Assert counts and lists with retrying assertions (`toHaveCount`, `toHaveText`, `expect.poll`), never with a one time read such as `expect(await locator.count()).toBe(0)`.
- Prefer role and label locators (`getByRole`, `getByLabel`) over CSS attribute selectors.
- Dates are computed from the clock. The calendar spec picks the next pair of Tuesdays that straddle a Europe/Berlin daylight saving change, so it never schedules into the past.

## Testing payments against Stripe test mode

The Playwright suite talks to a fake Stripe server, in CI and locally. No CI job runs against real Stripe. Before a release, a person runs journeys 2, 4 and 10 by hand against a Stripe sandbox. This run is a human gate: a release waits for it, because only Stripe can prove the hosted onboarding, Checkout, the customer portal, Connect events, and the application fee. The run on 2026-10-18 is recorded in [payments.md](../architecture/payments.md) section 13.7.

Setup, once per sandbox:

1. Create a sandbox in the Stripe Dashboard and copy its secret key (`sk_test_` or `rk_test_`) into `STRIPE_SECRET_KEY` in the root `.env`. Set `COHORY_EDITION=cloud` and `PLATFORM_FEE_BPS=200`. The `.env` file is ignored by git. Never paste a key into a tracked file, a log, or a report.
2. Enable Connect in the sandbox. The Stripe CLI can do it without the Dashboard: install the tools plugin with `stripe plugin install tools` and run `stripe tools enable_connect --api-key "$STRIPE_SECRET_KEY"`. Until Connect is enabled, creating a connected account fails with `non_connect_platform_accounts_v2_access_blocked`, which the server logs with the request id.
3. Start the webhook listener with `scripts/stripe-dev.sh <port>`. It forwards platform and Connect events to `/api/webhooks/stripe` and prints one signing secret. Put that value into both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`. Start the listener after Connect is enabled: a listener started earlier keeps its session and never forwards connected account events.
4. Start the web app and the worker against a database that has the migrations and the seed. The worker runs the exit run that a disconnect schedules.

What to check, in order:

- Journey 2: Manage, Payments, "Connect your Stripe account" creates an Accounts v2 account (`acct_`) with `dashboard = full` and the platform's country, and opens the hosted onboarding. Stripe's test mode form offers test data, but it sits behind a captcha, so complete it by hand in a normal browser. After the return the page reads the account state from Stripe; "Connected" needs `card_payments` active. Save a monthly and an annual price and confirm with `stripe prices list --stripe-account acct_...` that they live on the connected account.
- Journey 4: buy through the hosted Checkout with card `4242 4242 4242 4242`. The return URL shows "You're in" once the Connect events arrive. Confirm the subscription on the connected account carries `application_fee_percent = 2`, the charge has an application fee of two percent on the platform account, and Manage, Payments lists the member with the fee. In test mode Checkout succeeds on an account that has not finished onboarding; the app still refuses to sell until Stripe reports charges enabled.
- Journey 10: force a failed renewal by attaching the payment method `pm_card_chargeCustomerFail` as the default and invoicing a change (`items[0][quantity]=2` with `proration_behavior=always_invoice`). The community shows the "Payment failed" banner and access continues. Cancel at period end through the portal ("Manage billing"), then cancel immediately with `stripe subscriptions cancel`, refund the charge with `stripe refunds create --charge ch_...`, and check the ledger has a `fee_refunded` entry for the whole fee.
- Disconnect: after a purchase, "Disconnect Stripe" on Manage, Payments with "Take my members with me" shows Disconnecting, the worker clears `application_fee_percent` on the subscription within a few seconds (`stripe subscriptions retrieve sub_... --stripe-account acct_...`), and only then does the page show Connect your Stripe account again. With "Wind down" the subscription also gets `cancel_at_period_end`. The member gets the notice and email that the creator bills them directly. The end to end journey is `apps/e2e/tests/safe-exit-disconnect.spec.ts`.
- Delete: after a purchase, archive the community, then Delete community in the danger zone. The dialog says "1 paying member. Their subscriptions are cancelled now and they are not charged again."; the worker cancels the subscription (`stripe subscriptions retrieve sub_... --stripe-account acct_...` shows `canceled` and no proration invoice) and only then deletes the community. The member gets the "has closed" email. The end to end journey, including a cancel that keeps failing and Try again, is `apps/e2e/tests/safe-exit-delete.spec.ts`.
- Fee after leaving: on an account that is already disconnected, create and pay an invoice with `application_fee_amount` for the member (`--stripe-account acct_...`). Cohory refunds the whole fee by itself and writes `fee_collected` at rate 0 and `fee_refunded`; `stripe events resend` of the `application_fee.created` event changes nothing. The 0.11.0 run of disconnect, wind down, fee after leaving, and delete is recorded in [payments.md](../architecture/payments.md) section 13.16.
- Safe exit runs need one connected account per path (take members, wind down, delete), because each path closes or deletes what it uses. Keep a list of every id you create outside the repository, and clean up only those: cancel their subscriptions, archive their products, and delete those connected accounts. Never touch an account, customer, or subscription that was there before the run.
- Bring your existing subscribers: set `STRIPE_CONNECT_CLIENT_ID` to the platform's `ca_` id (subscriptions the platform creates on the connected account carry it), create a customer with an email, a default payment method, and a subscription on the connected account (`--stripe-account acct_...`), then open Manage, Payments, "Review existing subscriptions". Discovery lists only subscriptions without a test clock; link a test clock subscription by id through the service and advance the clock to see `invoice.paid` update the mirror. Details of the 2026-10-18 run are in payments.md section 13.10.
- Edge cases: `stripe events resend evt_... --account acct_...` answers 200 with outcome `duplicate`; an older event replayed after a cancellation leaves the mirror canceled because the handler fetches the current object; a request signed with another secret answers 400.

Clean up the sandbox afterwards: cancel subscriptions, archive products, and delete the connected accounts you created (`stripe accounts delete acct_...`). Sandboxes are isolated from live data, but leftovers make the next run harder to read.

## Upgrade path

`scripts/upgrade-check.sh` proves that a database from an older release upgrades cleanly (see [self-hosting](../self-hosting.md#upgrading)):

1. Starts an isolated PostgreSQL (Compose project `cohoryupgrade`, `127.0.0.1:55311`).
2. Applies migrations only up to `UPGRADE_FROM` (default `0004`).
3. Inserts an account with a password, a public community, an owner membership, and a post in the shape that schema had, plus a Stripe connection when the starting point is `0010` or later.
4. Starts the current migrations service, web, and worker, then runs the seed.
5. Checks that health is ok, every migration is applied, the community is readable through the API, the old account signs in, its post is listed, and the application role reads the post under row level security. From a starting point before `0029` it also checks that the old Stripe connection records its owner in `accepted_owner_id`.
6. Removes the project and its volumes.

Run it from another starting point with `UPGRADE_FROM=0008 scripts/upgrade-check.sh`.

## CI

`.github/workflows/e2e.yml` runs on pull requests and on pushes to `main`:

- **Playwright on Compose** builds the image once with Buildx (GitHub Actions cache, scope `e2e`) as `cohory:e2e` (`COHORY_VERSION=e2e`), installs Chromium with its system packages, runs `E2E_SKIP_BUILD=1 pnpm e2e` with two workers and one retry, uploads the HTML report on every run and the traces and screenshots when it fails.
- **Upgrade path** builds the same image from the cache and runs `scripts/upgrade-check.sh`.

## Decisions and open questions

- **Recommendation:** the suite lives in `apps/e2e` and runs against the production image in Compose, not against `next dev`. `pnpm e2e:host` runs it against `next start` on the host for the inner loop ([0046](../decisions/0046-test-slots-and-host-e2e.md)).
- **Recommendation:** one machine wide pool of 2 test slots, and an e2e run takes all of them ([0046](../decisions/0046-test-slots-and-host-e2e.md)).
- **Recommendation:** people are created per spec instead of shared seed users, so specs stay independent.
- **Recommendation:** known accessibility defects are listed in one place and reported, not ignored silently.
- **Recommendation:** workers run `pnpm verify:changed` and the person landing runs `pnpm verify` and `pnpm e2e`. Turbo caps of 3 packages and 2 Vitest workers per package were picked from measurements on an 8 core laptop (the Step 18 test speed work).
- **Recommendation:** the shared test services stack holds only PostgreSQL. Integration tests need nothing else; the e2e stack keeps its own fake Stripe, fake Polar, and webhook receiver in its Compose network.
- **Recommendation:** the payments journeys run against a fake Stripe API in the Compose network, not stripe-mock (it has no Accounts v2) and not Stripe test mode (CI would need a secret and network access). Real test mode stays a manual release check.
