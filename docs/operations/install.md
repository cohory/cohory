# Install on a server

How to take a clean Linux server to a working community at your own domain, with HTTPS, backups, and the production Compose overlay.

This guide is written for Ubuntu 24.04 LTS on a server with 2 vCPU and 4 GB of RAM (the reference size, REQ-NFR-HOST-001), but any Linux with Docker works. No outside account is needed except a domain name and, if you want email, an SMTP server.

## What was tested

Every command below except the DNS and Let's Encrypt steps was run for 0.2.0 (2026-10-18) on a laptop (Apple M1, Docker Desktop 28.3.3, Compose 2.39.2) with `docker-compose.yml` plus `docker-compose.prod.yml`:

- with `CADDY_SITE_ADDRESS=http://:80`: health through Caddy, sign up, gzip responses, memory limits, restart policies, and log rotation checked with `docker inspect`;
- with `CADDY_SITE_ADDRESS=localhost` (Caddy's internal certificate authority): HTTPS on HTTP/2, a `__Secure-` session cookie with `Secure`, an HTTP to HTTPS redirect, and four sign in attempts with four forged `X-Forwarded-For` values counted as one client (the fourth got HTTP 429 with `RATE_LIMIT_SIGN_IN=3/60`).

A release check then followed this guide in a fresh clone on the same laptop with `CADDY_SITE_ADDRESS=localhost` and Caddy on ports 3982 and 3983: clone to first backup took 8 minutes and 19 seconds including a cold image build of 71 seconds. Two defects found on the way are fixed in this version: base64 database passwords broke the connection URL (the guide now says `openssl rand -hex 32`), and Caddy forwarded the host without its port, which made Next.js reject server actions on a port other than 443. A backup, `docker compose down -v`, and restore brought back the account, the community, the post, and its image with the same checksum.

Not tested, because it needs a public host name: getting a Let's Encrypt certificate for a real `DOMAIN`, and the time a fresh VPS takes. REQ-NFR-HOST-003 asks for under 30 minutes; the steps below are short enough for that (**Assumption**), with the image build as the slowest step (about 5 to 10 minutes on 2 vCPU, not measured on a VPS).

## 1. Prepare the server

Point an `A` record (and `AAAA` if the server has IPv6) for your domain, for example `community.example.com`, at the server. Caddy needs it to resolve before the first start.

Install Docker Engine with the Compose plugin from Docker's repository (see https://docs.docker.com/engine/install/ubuntu/, checked 2026-10-18), then check the versions. The overlay needs Compose 2.24 or newer.

```sh
docker --version
docker compose version
```

Open only SSH, HTTP, and HTTPS:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Docker publishes ports around `ufw`, which is why the Compose files publish only Caddy to the network: PostgreSQL and `web` have no host ports in the production overlay.

## 2. Get the code and configure

```sh
sudo mkdir -p /opt/cohory && sudo chown "$USER" /opt/cohory
git clone <repository-url> /opt/cohory
cd /opt/cohory
git checkout v0.12.0  # or stay on main if the tag has not been pushed yet
cp .env.production.example .env
chmod 600 .env
```

Fill in `.env`. Generate `BETTER_AUTH_SECRET` and `PAYMENTS_ENCRYPTION_KEY` with `openssl rand -base64 32` and the two database passwords with `openssl rand -hex 32`. Compose puts the database passwords into connection URLs as they are, so they must not contain `/`, `+`, `=`, `@`, or `:`; base64 output does.

| Variable | Value |
|---|---|
| `DOMAIN` | `community.example.com` |
| `ACME_EMAIL` | An address Let's Encrypt can reach |
| `COHORY_VERSION` | `0.12.0` |
| `COHORY_IMAGE` | `cohory` to build here, or the published image name once there is one |
| `BETTER_AUTH_SECRET` | A random value |
| `ALLOW_INSECURE_HTTP` | Leave unset. Set `true` only when `APP_URL` is an `http://` address on a private network; anyone on that network can then read session cookies in transit. |
| `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD` | Two different random values from `openssl rand -hex 32` (letters and digits only) |
| `PAYMENTS_ENCRYPTION_KEY` | A random value (32 bytes, base64), needed when creators connect Stripe |
| `SMTP_*` | Your mail server, so sign up confirmations and password resets arrive. `SMTP_FROM` must be an address on your domain (for example `no-reply@community.example.com`), or the app refuses to send. Set `SMTP_REQUIRE_TLS=true` on port 587. Add SPF, DKIM, and DMARC records as described in [Email](../self-hosting.md#email) |

Make the overlay the default for every `docker compose` command and script in this folder:

```sh
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml' >> .env
```

Compose reads `COMPOSE_FILE` from `.env` in the project folder, so the rest of this guide uses plain `docker compose`.

## 3. Build or pull the image

No image is published yet. Build it on the server (or build elsewhere and `docker load` it):

```sh
docker compose build web
```

The build tags `cohory:0.12.0` from `COHORY_IMAGE` and `COHORY_VERSION`. Once releases are on a registry, set `COHORY_IMAGE` to it and run `docker compose pull` instead.

## 4. Start

```sh
docker compose up -d
docker compose ps
```

Expected: `postgres` healthy, `migrations` exited with code 0, `web` healthy, `worker` healthy, `caddy` healthy. Caddy asks Let's Encrypt for a certificate on the first request; watch it with `docker compose logs -f caddy`.

```sh
curl -s https://community.example.com/api/v1/health
```

returns `{"status":"ok","checks":{"config":"ok","database":"ok"}}`. A `503` with `"status":"degraded"` means a required variable is missing (`"config":"missing"`) or the database is unreachable; the `web` log names the missing variables.

## 5. Create your community

Open `https://community.example.com`, sign up (confirm your email if the app asks), and create a community. The first account has no special rights on the server; every creator signs up the same way. To connect Stripe, follow Manage, Payments in the app.

## 6. Schedule backups

```sh
sudo mkdir -p /srv/cohory-backups && sudo chown "$USER" /srv/cohory-backups
( crontab -l 2>/dev/null; echo '15 3 * * * cd /opt/cohory && scripts/backup.sh /srv/cohory-backups >> /srv/cohory-backups/backup.log 2>&1' ) | crontab -
scripts/backup.sh /srv/cohory-backups
```

Copy the backup folder and `.env` off the server. Restore and the rest of day to day operation are in the [operator guide](operator-guide.md).

## Database connections

Each web and worker process keeps a bounded pool. The defaults suit one web and one worker container on a small server; set these in `.env` to change them.

| Variable | Default | Meaning |
|---|---|---|
| `DB_POOL_MAX` | `10` | Connections for queries per process (the worker also uses it for its job runner) |
| `PGBOSS_POOL_MAX` | `3` | Connections per process shared by every module that queues jobs |
| `DB_CONNECTION_TIMEOUT_MS` | `10000` | How long a request waits for a free connection before it fails |
| `DB_STATEMENT_TIMEOUT_MS` | `60000` for web, `0` for the worker | Longest single query; `0` turns it off. The worker and its CLI default to no limit so long jobs (import restores, backfills) finish; setting the variable applies it to web and worker alike |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `60000` | Longest idle time inside an open transaction; `0` turns it off |

Keep the sum over all replicas (web plus worker, each `DB_POOL_MAX` plus `PGBOSS_POOL_MAX`, plus the worker's own job runner pool of `DB_POOL_MAX`) under the PostgreSQL `max_connections` setting (100 by default).

The `migrations` service runs without the statement and idle timeouts, but waits at most 10 seconds for a table lock. If a long running query holds a lock on a table a migration changes, the migration stops with `lock timeout` and changes nothing; run `docker compose up migrations` again when the server is quieter.

## Troubleshooting

| Symptom | Check |
|---|---|
| `migrations` logs `canceling statement due to lock timeout` | Another session held a lock on a table the migration changes. Nothing was applied; run `docker compose up migrations` again. |
| `required variable COHORY_VERSION is missing` (or `DOMAIN`, `ACME_EMAIL`) | The value is missing from `.env`. |
| `migrations` exited with a non zero code | `docker compose logs migrations`. Usually a wrong `POSTGRES_PASSWORD` after the volume was created with another one. |
| `migrations` logs `Invalid URL` for `DATABASE_URL` | A database password contains `/`, `+`, `=`, `@`, or `:`. Generate it with `openssl rand -hex 32`, run `docker compose down -v` (the volume was created with the old password), and start again. |
| `git checkout v0.12.0` fails with `did not match any file(s)` | The release tag has not been pushed yet. Stay on `main` and keep `COHORY_VERSION` at the version in `package.json`. |
| Caddy logs `challenge failed` | DNS does not point at this server yet, or ports 80 and 443 are blocked. |
| Sign in fails with "Invalid origin" | `APP_URL` (or `DOMAIN`) does not match the address in the browser. |
| No emails | Run `pnpm email:test you@example.com` from the checkout; it prints the error code and reason. The `email_log` table lists every send with its status and error code ([Email](../self-hosting.md#email)). |
| One person gets no emails, others do | Run `pnpm email:suppress check them@example.com`. A bounce, complaint, or opt out stops all but security email; `pnpm email:suppress remove them@example.com` lifts it once the address works ([Bounces, complaints, and opt outs](../self-hosting.md#bounces-complaints-and-opt-outs)). |
| Provider rejects mail for sending too fast | Lower `EMAIL_RATE_PER_SECOND` to the provider's limit. |
| Logs say `SMTP_FROM uses ... but APP_URL is on ...` | The sender address is not on your domain. Use an address on the `APP_URL` domain or its parent domain, or set `EMAIL_ALLOW_ANY_FROM=true` if your provider signs the other domain. |

## Decisions and open questions

- **Recommendation:** Ubuntu 24.04 LTS as the documented host, Caddy as the bundled proxy, backups to a local folder copied off the server.
- **Assumption:** a fresh VPS reaches a working community in under 30 minutes with this guide; not yet timed on a real VPS.
- **Open question:** the public registry and image name, which decide whether step 3 becomes `docker compose pull`.
