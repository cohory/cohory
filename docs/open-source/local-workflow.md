# Local workflow

The default way to build and check a change on a developer machine: what runs where, the loop for one task, and how the machine wide test budget works.

## What runs where

| What | Command | Runs on | When |
|------|---------|---------|------|
| Typecheck, lint, unit, Prettier, integration for changed packages | `pnpm verify:changed` | Host, one test slot | After every step of a task |
| End to end specs a change touches | `pnpm e2e:host <specs>` | Host (`next start`, worker, fake Stripe and Polar as Node processes, Postgres from the test services stack), every test slot | After `verify:changed` passes, for the specs the change touches |
| Every package, every integration test, the build | `pnpm verify` | Host, one test slot | Before landing |
| The whole e2e suite against the production image | `pnpm e2e` | Docker Compose, every test slot | Before landing a batch of changes, and for releases |
| The app for daily use | `pnpm stack:dev` | Host (`next dev`, worker with `--watch`), Compose Postgres on 5433 and Mailpit | Any time |
| A production image rebuild (`docker compose up -d --build`) | | Docker | Only to check a release or a self hosting change |

The Docker image is not rebuilt per change. `pnpm e2e` builds it only when its inputs changed and is the gate before landing, not a step of the inner loop.

## The loop for one task

1. Edit the code and its tests.
2. Run `pnpm verify:changed`. Do not continue on red.
3. Find the specs the change touches: the specs for the journeys you changed, and every spec that uses a label, button name, or heading you changed, for example `grep -rl "Request to join" apps/e2e`.
4. Run them on the host: `pnpm e2e:host tests/step10-joining.spec.ts tests/journey-03-join-free-community.spec.ts`. Add `E2E_MOBILE=1` when a phone layout changed.
5. Before landing, run `pnpm verify`, then `pnpm e2e` for the batch.

## Test slots

Every heavy command takes slots from one pool per machine, shared by all checkouts and worktrees, so parallel work never runs more than the machine can carry. The pool has `COHORY_TEST_SLOTS` slots (default 2). `pnpm verify`, `pnpm verify:changed`, and `pnpm test:integration:local` take one slot each; `pnpm e2e`, `pnpm e2e:host`, and `scripts/upgrade-check.sh` take all of them. A command that has to wait prints one line naming the holders, and requests are served in arrival order, so an e2e run is not overtaken by later verify runs. A command started by a holder (the integration step of `pnpm verify`) uses its holder's slot.

The pool lives in `/tmp/cohory-slots` (`COHORY_SLOTS_DIR`), one folder per taken slot with the holder's pid and label. To see who holds them:

```sh
cat /tmp/cohory-slots/slot-*/label
```

`bash scripts/lib/slots-test.sh` tests the pool on a private folder.

## The development stack

`pnpm stack:dev` runs `next dev` on port 3000 and the worker with `--watch` against the Compose Postgres and Mailpit, reading the root `.env`. Switch from the Compose app to it once:

```sh
docker compose stop web worker
docker compose --profile mail up -d postgres mailpit
pnpm db:migrate          # when the branch adds migrations
pnpm stack:dev
```

Mail goes to Mailpit on `127.0.0.1:1025` (the UI is http://localhost:8025) while `SMTP_HOST` is `mailpit` or unset. `docker compose up -d web worker` switches back to the production image.

## Reset the local database

`pnpm db:reset:local --yes` starts the development database over: it drops the `public`, `drizzle`, and `pgboss` schemas of the database in `DATABASE_ADMIN_URL` (or `DATABASE_URL`), deletes everything in the local uploads folder (`STORAGE_LOCAL_PATH`, resolved from `apps/web`), then runs `pnpm db:migrate`, `pnpm db:seed`, and `pnpm db:seed:paid`. The paid seed needs a Stripe sandbox key in `STRIPE_SECRET_KEY`, `COHORY_EDITION=cloud`, and `PAID_SEED_ACCOUNT_ID` set to a connected account (`acct_`) in that sandbox; without them it is refused with a warning, and Cohory Pro stays without a price. The command refuses without `--yes`, when `NODE_ENV` is `production`, and when either database URL points anywhere but `localhost` or `127.0.0.1`. Stop the web app and the worker first.

With `pnpm stack:dev`, stop it and run the command with the root `.env`. For the Compose app (project `cohory`, Postgres on 5433, uploads in the `uploads` volume), point the reset at the Compose Postgres with the application user in `DATABASE_URL`, so the migration step grants it the new tables, and copy the seeded images into the volume afterwards:

```sh
docker compose stop web worker
DATABASE_URL=postgres://cohory_app:cohory_app@127.0.0.1:5433/cohory \
DATABASE_ADMIN_URL=postgres://cohory:cohory@127.0.0.1:5433/cohory \
STORAGE_DRIVER=local STORAGE_LOCAL_PATH=/tmp/cohory-seed-uploads \
  pnpm db:reset:local --yes
docker compose up -d web worker
docker compose exec -T -u 0 web sh -c 'rm -rf /data/uploads/*'
docker compose cp /tmp/cohory-seed-uploads/. web:/data/uploads/
docker compose exec -T -u 0 web chown -R cohory:cohory /data/uploads
rm -rf /tmp/cohory-seed-uploads
```

Use the user names and passwords from your `.env` if you changed `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_APP_USER`, or `POSTGRES_APP_PASSWORD`.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| A command waits for slots that nobody seems to use | A slot whose holder process is gone is removed by the next waiter. A slot handed to pid 0 (a stack kept with `E2E_KEEP_STACK=1` or started with `scripts/e2e-up.sh`) stays until `scripts/e2e-down.sh` or 4 hours (`COHORY_LOCK_STALE_MINUTES`). Check `cat /tmp/cohory-slots/slot-*/label`, then stop that stack. |
| `port 3310 is already in use` from `pnpm e2e:host` | Another app listens on one of the ports 3310 to 3315. Stop it; `pnpm e2e:host` never stops processes it did not start. |
| `port 3000 is in use` from `pnpm stack:dev` | The Compose web app still runs. `docker compose stop web worker`. |
| Docker is down | `pnpm verify:changed` with `VERIFY_SKIP_INTEGRATION=1` and `pnpm stack:dev` against a local PostgreSQL keep working. Integration tests and `pnpm e2e:host` need the test services Postgres, and `pnpm e2e` needs Docker. |
| A host e2e run failed | The service logs are in `apps/e2e/test-results/host-logs`, next to the Playwright report. |

More detail on each suite is in [testing](testing.md).

## Decisions and open questions

- **Confirmed** ([0046](../decisions/0046-test-slots-and-host-e2e.md)): one machine wide pool of 2 test slots, an e2e run takes all of them, and `pnpm e2e:host` runs the specs on the host for the inner loop.
- **Recommendation:** `pnpm e2e` against the production image is the gate before landing a batch and for releases, not a step of the inner loop.
