# Operator guide

Day to day operation of a self-hosted Cohory server: configuration, backups and restores, logs, upgrades, fair use limits, and rotating secrets.

This guide assumes the setup from [install.md](install.md): the repository in `/opt/cohory`, `.env` next to it with `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`, and commands run from that folder. Reference material (services, volumes, database roles, rate limits) is in [../self-hosting.md](../self-hosting.md).

## Configuration

All settings are environment variables in `.env`. Containers read them when they start, so after a change run `docker compose up -d` (it recreates only the services whose settings changed). Nothing needs a rebuild: the public URL is read at runtime.

| Group | Variables | Notes |
|---|---|---|
| Public URL | `DOMAIN`, `APP_URL`, `BETTER_AUTH_URL` | `APP_URL` defaults to `https://$DOMAIN`, and `BETTER_AUTH_URL` to `APP_URL`. Links in emails, invite links, calendar files, and Stripe return URLs use it. With `NODE_ENV=production`, `BETTER_AUTH_URL` must use `https://` (only `localhost`, `127.0.0.1`, and `[::1]` may use `http://`), so session cookies always carry `Secure`. A server reachable only on a private network (a LAN or Tailscale address) can set `ALLOW_INSECURE_HTTP=true` to use `http://`; anyone on that network can then read session cookies in transit. |
| Image | `COHORY_IMAGE`, `COHORY_VERSION` | Pin an exact version or a minor tag. |
| Database | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | See [Database roles](../self-hosting.md#database-roles). |
| Secrets | `BETTER_AUTH_SECRET` (and optionally `BETTER_AUTH_SECRETS`), `PAYMENTS_ENCRYPTION_KEY` (or `PAYMENTS_ENCRYPTION_KEYS`), `WEBHOOKS_ENCRYPTION_KEY` (or `WEBHOOKS_ENCRYPTION_KEYS`) | See [Rotating secrets](#rotating-secrets). |
| Email | `EMAIL_DRIVER`, `SMTP_*` | `smtp` turns on email verification at sign up; see [Email and sign in](#email-and-sign-in). |
| Storage | `STORAGE_DRIVER`, `STORAGE_*`, `S3_*` | |
| Edition and payments | `COHORY_EDITION`, `PLATFORM_FEE_BPS`, `STRIPE_*`, `COHORY_ENABLE_POLAR` | Self-hosted servers keep `COHORY_EDITION=community`. `PLATFORM_FEE_BPS` defaults to `200` and is ignored on the Community Edition. `COHORY_ENABLE_POLAR` defaults to `false`; see [payment-providers.md](payment-providers.md#which-providers-you-can-choose). |
| Limits | `RATE_LIMIT_*`, `FAIR_USE_*` | See [Limits](#limits). |
| Proxy and resources | `HTTP_BIND`, `HTTPS_BIND`, `CADDY_SITE_ADDRESS`, `*_MEMORY_LIMIT`, `LOG_MAX_SIZE`, `LOG_MAX_FILE` | Production overlay only. |
| Base file only | `APP_BIND`, `APP_PORT`, `POSTGRES_HOST_PORT` | `web` binds to `127.0.0.1:3000` by default. The overlay removes these host ports. |

The full list with comments is in `.env.production.example` and `.env.example`.

## Email and sign in

With `EMAIL_DRIVER=smtp`, people who sign up with email and password must confirm their email before they can sign in, magic link sign in is offered, and people can change their email address on Account, Security ([0038](../decisions/0038-email-verification-required.md)). Account emails go through the worker's `email.send` job, which retries 4 times with backoff, so a short mail server outage delays them instead of losing them. Because the jobs hold sign in links, the queue drops any job, waiting or finished, after 15 minutes; if the worker is stopped longer than that, people ask for a new link. Better Auth logs only warnings and errors, with email addresses replaced by `[email]`.

With `EMAIL_DRIVER=log`, verification stays off: the server cannot deliver a confirmation link, and requiring one would lock every new person out. Sign up then signs people in at once, and magic links and email changes are not offered. Use `log` until your mail server works, and do not leave `smtp` pointing at a server that does not deliver mail, or new people cannot finish signing up.

When you switch an existing server to `smtp`, accounts that were never confirmed can no longer sign in with their password until their owners confirm (sign in offers "Send a new link"). To spare them that, first check how many accounts it would change, with the time you switched:

```sh
docker compose exec worker node apps/worker/dist/accounts-cli.js mark-verified --created-before 2026-10-22T09:00:00Z
```

This changes nothing. It prints the number of unconfirmed accounts created before that time and the earliest and latest creation time among them. If that looks right, run the same command with `--yes` at the end. It marks those accounts as confirmed, writes an entry to each account's audit log, and prints the same numbers. (`pnpm accounts mark-verified --created-before <ISO time> [--yes]` on a source checkout.) Accounts created after that time still confirm their email themselves.

## Health and logs

```sh
docker compose ps
curl -s https://community.example.com/api/v1/health
docker compose logs -f --tail 100 web worker
docker compose logs caddy | tail -n 20
```

`/api/v1/health` is the readiness check: it answers `200` when the required configuration (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) is valid and the database answers `select 1` within 3 seconds, and `503` with the failing check otherwise. The `web` healthcheck uses it, so a container with a missing secret or no database shows `unhealthy`. `/api/v1/health/live` only proves the process runs.

Every long running service has a healthcheck, and Compose restarts any service that exits (`restart: unless-stopped`).

The worker writes a heartbeat file (`WORKER_HEARTBEAT_FILE`, default `/tmp/cohory-worker.heartbeat`) every 15 seconds, after a `select 1` through its job queue connection succeeds. Its healthcheck (`node apps/worker/dist/healthcheck.js`) fails when the last beat is older than 90 seconds (`WORKER_HEARTBEAT_MAX_AGE_MS`), so a worker that hangs or loses the database shows `unhealthy` in `docker compose ps`. Compose itself does not restart unhealthy containers, so the production overlay runs the check with `--restart`: it stops the stale worker process, the container exits, and the restart policy starts a new one. The worker runs under `init: true` for this, because a process cannot signal the first process of its own container. A worker that cannot reach the database keeps restarting until it can; its log shows `worker heartbeat probe failed` and `pg-boss error` lines.

Likes, comments, and mentions reach the notification bell through the `notifications.fanout` queue. When that queue is empty the worker checks it again every 2 seconds (`WORKER_FANOUT_POLL_SECONDS`, from 0.5 to 60). A lower value shows notices sooner and costs more database queries.

Each container's log is rotated by Docker at `LOG_MAX_SIZE` (10 MB) with `LOG_MAX_FILE` (5) files, so logs use at most about 50 MB per container. Caddy writes one JSON line per request. The app never logs secrets, session cookies, or card data; it logs ids and event types.

### Payment webhooks that did not process

Stripe webhooks are stored and answered at once, then processed by the worker ([0030](../decisions/0030-payment-webhooks-in-the-worker.md)). A job that fails is retried 10 times with backoff; when the last retry fails the worker logs `payment webhook retries exhausted` with the inbox row id. Every hour at minute 17 the `payments.webhook-sweep` job queues again every Stripe event still unprocessed after one hour and younger than three days. An event still unprocessed after three days is logged once as `payment webhook event abandoned` at error level, with the provider, the Stripe event id, and the type, never the payload. Alert on both messages.

To retry one event after fixing the cause, queue it again by its Stripe event id:

```sh
docker compose exec worker node apps/worker/dist/billing-cli.js replay-webhook evt_123
```

From a checkout with the production environment loaded, `pnpm billing replay-webhook evt_123` does the same. The command prints `queued`, `processed` (nothing to do), or `not_found`. It works for connected account and platform billing events, abandoned ones included, as long as Stripe still keeps the event (30 days).

## Backups and restores

`scripts/backup.sh` and `scripts/restore.sh` are described in [Backups](../self-hosting.md#backups). In short:

```sh
scripts/backup.sh /srv/cohory-backups          # daily from cron, keeps 7 sets
scripts/restore.sh /srv/cohory-backups/cohory-<stamp>.dump          # into an empty stack
scripts/restore.sh --force /srv/cohory-backups/cohory-<stamp>.dump  # replaces current data
```

Keep `.env` with the backups but in a separate place: a dump without the matching `PAYMENTS_ENCRYPTION_KEY` restores everything except creators' Stripe keys. Practice a restore on a spare machine every few months.

## Upgrades

1. Read the release notes for breaking changes and new variables.
2. Take a backup: `scripts/backup.sh /srv/cohory-backups`.
3. Set `COHORY_VERSION` in `.env` to the new release, and `git checkout v<version>` so the Compose files and scripts match.
4. Pull or build: `docker compose pull` with the default `COHORY_IMAGE=ghcr.io/cohory/cohory`, or `docker compose build web` when `COHORY_IMAGE=cohory` and you build on the server ([install guide](install.md) section 3).
5. Start: `docker compose up -d`. `migrations` runs first; `web` and `worker` start only if it exits with code 0.
6. Check `docker compose ps` and the health endpoint.

Migrations are forward only. To go back, restore the backup from step 2 with the older version checked out. Before an upgrade you are unsure of, `scripts/upgrade-check.sh` replays the upgrade path on a throwaway project (see [How the upgrade path is tested](../self-hosting.md#how-the-upgrade-path-is-tested)).

## Limits

Rate limits (`RATE_LIMIT_*`) protect sign in, sign up, invites, and posting; the table is in [Rate limits](../self-hosting.md#rate-limits). Behind the bundled Caddy the limiter sees the real client address because Caddy replaces any `X-Forwarded-For` the client sent with the address it sees, and the limiter reads the last entry. If you put another proxy or a CDN in front of Caddy, every client shares that proxy's address unless you configure Caddy's `trusted_proxies` for it; do that only for proxies you control. Better Auth reads the same last entry, so the address stored with each session in Account, Security matches the one the limiter counts.

Sign in is limited twice: per client address (`RATE_LIMIT_SIGN_IN`), and per account (the normalized email) with `RATE_LIMIT_SIGN_IN_ACCOUNT`, 50 failed attempts per 15 minutes by default, so guessing one person's password from many addresses is slowed too. Only failed attempts count per account, so someone who keeps a person's account at the limit has to fail 50 times per 15 minutes from addresses the per address limit lets through.

Run `web` as a single instance. Rate limit counters, both ours and the few Better Auth keeps for itself (password change, verification email), live in the memory of the `web` process: they reset when it restarts, and two `web` replicas would each count separately and allow twice the attempts. The bundled Compose files start one `web`, which is the supported setup.

Fair use limits (`FAIR_USE_*`) cap members, storage, and upload size per community. The Community Edition has none by default. Set them when you host communities for other people; see [Fair use limits](../self-hosting.md#fair-use-limits). Usage is visible to admins and owners in Manage, Overview.

## Rotating secrets

| Secret | How to rotate | Effect |
|---|---|---|
| `POSTGRES_APP_PASSWORD` | Change it in `.env`, then `docker compose up -d`. The `migrations` service sets the new password on the application role before `web` and `worker` restart. | None for users. |
| `POSTGRES_PASSWORD` | Change the role first, then `.env`: `docker compose exec postgres psql -U cohory -d cohory -c "alter role cohory password '<new>'"`, edit `.env`, `docker compose up -d`. The `postgres` image reads `POSTGRES_PASSWORD` only when the volume is first created. | None for users. |
| `BETTER_AUTH_SECRET` | With `NODE_ENV=production` and a public URL other than `localhost`, `127.0.0.1`, or `[::1]`, sign in refuses the placeholder from `.env.example` and values that do not look random; generate one with `openssl rand -base64 32`. If `WEBHOOKS_ENCRYPTION_KEY` is empty, webhook endpoint secrets are encrypted with a key derived from this secret: first set `WEBHOOKS_ENCRYPTION_KEYS` to a new key, `docker compose up -d`, and run the rotate command below. Then change `BETTER_AUTH_SECRET` in `.env` and `docker compose up -d`. | Every session ends and everyone signs in again. Password reset links already sent stop working. |
| `BETTER_AUTH_SECRETS` (optional) | Versioned Better Auth secrets, current first: `BETTER_AUTH_SECRETS=2:<new>,1:<old>`. Better Auth signs with the first one and still decrypts data sealed with the older ones. To rotate, add the new value with a higher version in front, `docker compose up -d`, and drop the old entry after a week. Keep `BETTER_AUTH_SECRET` set: unsubscribe links, agent download links, and the derived webhook key still read it. | Better Auth 1.7 checks session cookies and email verification links against the current secret only, so changing the first entry still signs everyone out. The versions keep encrypted values readable, which matters once OAuth sign in or an encrypted cookie cache is turned on; today neither is. |
| `PAYMENTS_ENCRYPTION_KEY` | Generate a new key (`openssl rand -base64 32`) and set `PAYMENTS_ENCRYPTION_KEYS=<new>,<old>` in `.env` (current key first, comma separated), then `docker compose up -d`. New secrets are encrypted with the first key and every key in the list still decrypts. Run `docker compose exec worker node apps/worker/dist/secrets-cli.js rotate` (or `pnpm secrets rotate`) to re-encrypt every stored secret now; the worker also does it every hour (`secrets.reencrypt`). When the command reports no `unreadable` ids, drop the old key from the list. | None for creators. Keep the old key until the rotate command finished. |
| `WEBHOOKS_ENCRYPTION_KEY` | The same way, with `WEBHOOKS_ENCRYPTION_KEYS=<new>,<old>` and the same rotate command. | None for receivers; signing secrets do not change. |
| Stripe keys and webhook secrets | Roll them in the Stripe dashboard, update `STRIPE_*` in `.env`, `docker compose up -d`. | Webhooks signed with the old secret are refused after the change. |
| SMTP password | Update `SMTP_PASSWORD`, `docker compose up -d`. | None. |

After any rotation, take a new backup and store the new `.env` with it.

## Resources

The overlay limits memory to the REQ-NFR-HOST-002 budget: web 1 GB, worker 512 MB, PostgreSQL 1 GB, Caddy 256 MB. A container that reaches its limit is killed and restarted, which shows as a restart count in `docker compose ps`; raise the matching `*_MEMORY_LIMIT` if that happens. Measured request latencies under load are in [load-test.md](load-test.md).

## Decisions and open questions

- **Recommendation:** run every command from the repository folder with `COMPOSE_FILE` in `.env`, so scripts and plain `docker compose` see the same stack.
- **Recommendation:** stored secrets carry the id of the key that sealed them (`v2.<key id>.<ciphertext>`), so the worker knows which rows still use an old key. Values written before 0.9 (`v1`) are tried with every key and re-encrypted by the next sweep.
- **Recommendation:** the worker heartbeat is a file, not an HTTP port, so the worker opens no listener.
