# Self-hosting

How to run cohory on your own server with Docker Compose. This page is the index for self-hosting and the reference for services, data, backups, upgrades, limits, and the reverse proxy.

Status: Draft, 2026-10-23

No image is published yet, so Compose builds the image from this repository. The design behind this setup is in [architecture/overview.md](architecture/overview.md) section 12 and [ADR 0005](decisions/0005-postgres-job-queue.md).

## Guides

| Guide | For |
|---|---|
| [operations/install.md](operations/install.md) | A clean server to a working community at your domain with HTTPS, using the production overlay |
| [operations/operator-guide.md](operations/operator-guide.md) | Day to day: configuration, health and logs, backups and restores, upgrades, limits, rotating secrets |
| [operations/load-test.md](operations/load-test.md) | Measured latencies at the reference load and how to run the load test yourself |
| [operations/offboarding.md](operations/offboarding.md) | Moving a community from Cloud to your server: export, import, payments, and the command line tools |

The rest of this page is reference material. For a quick local try without a domain, follow [First start](#first-start).

## What runs

One image (`cohory:local` by default) is started with three commands, so web, worker, and migrations can never run different versions.

| Service | Command | Role |
|---|---|---|
| `postgres` | PostgreSQL 17 | The only required data store. Also holds the job queue (pg-boss). |
| `migrations` | `node packages/db/dist/migrate.js` | Applies pending migrations as the schema owner, creates or updates the application role, then exits with code 0. |
| `web` | `node apps/web/server.js` | Next.js app and `/api/v1`. Starts after migrations succeed. |
| `worker` | `node apps/worker/dist/index.js` | Background jobs on pg-boss. Starts after migrations succeed. |
| `redis` | Redis 7, profile `redis` | Optional. Nothing uses it yet. |
| `mailpit` | Mailpit, profile `mail` | Optional local inbox for testing email. |
| `caddy` | Caddy 2.10.2, production overlay only | Reverse proxy with automatic HTTPS. See [Reverse proxy and TLS](#reverse-proxy-and-tls). |

No outside account or hosted service is needed. Containers run as a non-root user (uid 1001).

## Database port

The Compose file publishes PostgreSQL on `127.0.0.1:5433` (host side) so local tools can connect without clashing with a PostgreSQL already running on 5432. Inside the Compose network the services still use `postgres:5432`. Change the host binding with `POSTGRES_HOST_PORT` in `.env`.

## Cleaning up

Repeated builds leave dangling images and build cache behind. Run `scripts/docker-clean.sh` to stop the cohory stack (including its volumes), prune dangling images and the build cache, and remove volumes no container uses. It never touches other projects. Note that it deletes the local database volume. When you start throwaway containers by hand, use `docker run --rm` and `docker rm -fv` so no anonymous volume is left behind.

## Requirements

- Docker Engine 24 or newer with the Compose plugin (`docker compose version`).
- 2 vCPU and 4 GB of RAM for a single community. Building the image is the heaviest step; on a smaller machine, build elsewhere and copy the image over.
- A few GB of disk for images and build cache, plus space for your database and uploads.

## First start

```sh
git clone <repository-url> cohory
cd cohory
cp .env.example .env
```

Edit `.env` before the first start:

- `BETTER_AUTH_SECRET`: set a random value, for example from `openssl rand -base64 32`.
- `POSTGRES_PASSWORD` and `POSTGRES_APP_PASSWORD`: set two strong passwords. Compose builds the connection strings for the containers from the `POSTGRES_*` values, so the `DATABASE_URL` and `DATABASE_ADMIN_URL` lines in `.env` only matter for tools you run outside Docker. See [Database roles](#database-roles).
- `APP_URL` and `BETTER_AUTH_URL`: set the public URL, for example `https://community.example.com`. Both are read when the containers start, so the same image works on any host and changing the URL needs only `docker compose up -d`, not a rebuild. Compose copies `APP_URL` into `BETTER_AUTH_URL` (and into `NEXT_PUBLIC_APP_URL`, which payments still reads) when those are unset.
- `SMTP_*`: point at your mail server. The example file uses `SMTP_HOST=mailpit` and `SMTP_PORT=1025`, the Mailpit container of the `mail` profile. When you run the app outside Docker with Mailpit on the same machine, use `SMTP_HOST=localhost`. See [Email](#email) before you send to real people.
- `APP_PORT`: the host port for the web app (default 3000).
- `INSTANCE_NAME` and `INSTANCE_LOGO_URL` (optional): your site's name and logo for the header, page titles, and sign in text. The logo must be a path such as `/logo.svg` or a URL on the `APP_URL` address, because the browser blocks images from other sites. Without them the server shows "Cohory" and its icon.
- `HOME_COMMUNITY` (optional): a community slug. Signed out visitors who open `/` go to that community's About page instead of the home page (on the Community Edition, a welcome page with your instance name and Create your community).
- `CREATORS_COMMUNITY_SLUG` (optional): the slug of a community on this server for the people who run communities here, for example `cohory-creators`. When that community exists, every footer shows its name as a link to it (visitors and non members land on its About page), and each person who creates a community gets one email inviting them to join it: right after the first post or course is published in their community, or 3 days after they created it, whichever comes first. The email comes from that community's owner as an ordinary invite link (one use, no approval, 30 days, listed under Invite people). It is sent once per person and never to someone who is already a member, is banned there, owns it, has an unconfirmed address, or opted out of its emails or all email. Leave it empty for no link and no email; nothing is sent to cohory.org either way ([0048](decisions/0048-creators-community-invitation.md)).
- `SIGNUP_MODE` (optional, default `open`): who may create an account. `open` lets anyone sign up. `invite` accepts a new account only when it continues an active community invite link; a plain sign up, or a join from a community's page, shows "You need an invite", and the refusal is the same whichever community was named. `closed` refuses every new account; people who already have one still sign in. The server enforces the mode, so a request that skips the page is refused too.
- `COMMUNITY_CREATION` and `OPERATOR_EMAILS` (optional): `COMMUNITY_CREATION=anyone` (the default) lets every signed in person create a community. `COMMUNITY_CREATION=operators` limits it to the accounts whose confirmed email is in `OPERATOR_EMAILS`, a comma separated list that must not be empty in that case. Everyone else does not see Create a community. Run a single community with `SIGNUP_MODE=invite` and `COMMUNITY_CREATION=operators` so strangers cannot open accounts or communities you are responsible for. A Cloud beta keeps `SIGNUP_MODE=open` with `COMMUNITY_CREATION=operators`: anyone joins communities, only the listed creators start one, and the Cloud landing and pricing show Request early access (to `/early-access`, which emails `CONTACT_EMAIL`) and Self-host now instead of Create your community. The communities service enforces it, so `POST /api/v1/communities` answers 403 `community_creation_restricted` too.
- Legal and trust links (optional, see [Legal pages and contact](#legal-pages-and-contact)): `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_IMPRINT_URL`, `LEGAL_GUIDELINES_URL`, `CONTACT_EMAIL`, `SECURITY_CONTACT`, `SECURITY_POLICY_URL`, `SOURCE_URL`, `STATUS_URL`, `TERMS_VERSION`, and `LEGAL_UPDATED_AT`.
- `SITEMAP_ENABLED` (optional, default `true`): `/sitemap.xml` lists the home page, the importer guides, and the About page of every public community (on the Cloud Edition also `/pricing` and `/open-source`, which do not exist on the Community Edition); private and archived communities are never listed. Set it to `false` to serve an empty sitemap and leave it out of `/robots.txt`. `/robots.txt` always keeps crawlers out of account, API, invite, OAuth, MCP, Manage, and membership pages.

Then build and start. The `mail` profile adds Mailpit, which catches every email (including the sign up confirmation you need to sign in) until `SMTP_*` points at a real mail server:

```sh
docker compose --profile mail up -d --build
docker compose ps
```

`postgres` should show `healthy`, `migrations` should show `Exited (0)`, and `web` and `worker` should be running. Check the app:

```sh
curl -s localhost:3000/api/v1/health
```

It returns `{"status":"ok","checks":{"config":"ok","database":"ok"}}`, or `503` with `"status":"degraded"` when required configuration is missing or the database is unreachable. `/api/v1/health/live` answers as soon as the process runs. The app answers only on `127.0.0.1`; to serve it on a domain, use the production overlay ([operations/install.md](operations/install.md)). Logs are available with `docker compose logs -f web worker`.

The Mailpit inbox is at `http://localhost:8025` and its SMTP server at `127.0.0.1:1025` (change the ports with `MAILPIT_UI_PORT` and `MAILPIT_SMTP_PORT`).

## Legal pages and contact

You run the server, so you are responsible for the data on it and for the rules people agree to. Cohory gives you the slots; you write the texts. Every value is optional. An invalid value fails the first request that reads it, with a message that names the variable.

| Variable | What it does |
|---|---|
| `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL` | `/terms` and `/privacy` redirect to these pages. When one is blank, its page shows a neutral notice that the people who run this server are responsible. Once `LEGAL_TERMS_URL` is set, sign up shows "By creating an account you agree to the Terms" (and the Privacy Policy when set) and stores `TERMS_VERSION` and the time on the account. |
| `LEGAL_IMPRINT_URL`, `LEGAL_GUIDELINES_URL` | Footer links. The guidelines link also shows on the create community form ("By creating a community you agree to the Community Guidelines"). |
| `CONTACT_EMAIL` | Turns on the Contact page at `/contact` (linked as Contact in the footer, as Contact support and Send feedback on error pages, as Send feedback in the account menu and at the end of Manage, Overview) and the public Report content form at `/legal/report`. Both email this address. A contact message has the sender as Reply-To, the topic, the message, and an optional link; when the sender is signed in it adds their user id, name, account email and whether it is verified, account creation date, up to 20 communities they own or belong to; every message also names the edition and the server address. It never carries sessions, tokens, payment data, or the full client address (only a short keyed hash of it). The form has a hidden honeypot field, refuses a send within 3 seconds of loading the page or after 2 hours, allows at most 3 links in a message from a signed out sender (10 when signed in), and is rate limited (see [Rate limits](#rate-limits)). When the email settings do not parse, `/contact` shows this address instead of the form. A signed in reporter with a confirmed address is the Reply-To of a content report and gets a receipt. Without `CONTACT_EMAIL` both forms are off and the footer has no Contact link. |
| `SECURITY_CONTACT` | An email address or an `https` URL for `/.well-known/security.txt` (RFC 9116). Falls back to `CONTACT_EMAIL`. Without either, the file answers 404. |
| `SECURITY_POLICY_URL` | An `https` page with your vulnerability disclosure policy, listed as `Policy` in `security.txt`. Left out when unset. |
| `SOURCE_URL` | Footer Source code link. If you change the code and let others use it, AGPL-3.0 section 13 asks you to offer them the source; point this at your copy. |
| `STATUS_URL` | Footer Status link and Service status on error pages. |
| `TERMS_VERSION` | The version recorded at sign up (default `1`). Raise it when your Terms change. It is stored on the account and not shown on the pages. |
| `LEGAL_UPDATED_AT` | The day the legal pages say they were last updated, as an ISO date such as `2026-10-23`. They show "Last updated 23 October 2026". When blank, the pages show the day the bundled texts last changed. |
| `LEGAL_ENTITY`, `GOVERNING_LAW`, `DATA_REGION` | Used only by the Cloud Edition texts, which show "[... not set]" until they are filled in. |

Every page has a footer with the links you set, plus Terms and Privacy, and "Powered by Cohory" with the version. Sign up always says "You must be 16 or older".

## Database roles

The stack uses two PostgreSQL roles so that row level security protects community data (see [architecture/multi-tenancy.md](architecture/multi-tenancy.md) section 3.4). Superusers bypass row level security, so the app must not run as one.

| Role | From | Used by | Rights |
|---|---|---|---|
| `POSTGRES_USER` (default `cohory`) | Created by the `postgres` image | `migrations`, backups, `psql` | Superuser and owner of the schema |
| `POSTGRES_APP_USER` (default `cohory_app`) | Created by `migrations` on every run | `web`, `worker` | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`. Read and write on the application tables, and `CREATE` on the database for the pg-boss schema |

Outside Docker the same split is `DATABASE_ADMIN_URL` (migrations and seed) and `DATABASE_URL` (web and worker). When `DATABASE_ADMIN_URL` is unset, everything uses `DATABASE_URL`, which is fine for development against a throwaway database. When the two users differ, the migration runner creates or updates the `DATABASE_URL` user with its password and grants after applying migrations, so changing `POSTGRES_APP_PASSWORD` and running `docker compose up -d` again rotates the password. The password travels in an `ALTER ROLE` statement, so keep PostgreSQL statement logging off (the default).

The auth tables (`users`, `sessions`, `accounts`, `verifications`) are platform level and have no row level security, so the application role needs no `BYPASSRLS` for sign-in.

Check that the protection is active from inside the stack:

```sh
docker compose exec -T postgres psql -U cohory_app -d cohory -Atc \
  "select rolsuper, rolbypassrls from pg_roles where rolname = current_user; select count(*) from memberships"
```

The first line is `f|f` and the count is `0`, because without `app.community_id` set the application role sees no membership rows.

## Where data lives

All state is in named Docker volumes. Containers can be removed and recreated freely; volumes survive until you delete them.

| Volume | Mounted at | Contents |
|---|---|---|
| `cohory_pgdata` | `/var/lib/postgresql/data` in `postgres` | The database, including queued jobs |
| `cohory_uploads` | `/data/uploads` in `web` and `worker` | Uploaded files when `STORAGE_DRIVER=local` |
| `cohory_redisdata` | `/data` in `redis` | Only used with the `redis` profile |

`docker compose down` keeps the volumes. `docker compose down -v` deletes them and all your data.

## Backups

Back up two things: the database and the uploads volume. `scripts/backup.sh` does both, and `scripts/restore.sh` puts them back. Run them from the repository root on the server.

```sh
scripts/backup.sh                       # writes to ./backups
BACKUP_KEEP=14 scripts/backup.sh /srv/cohory-backups
```

Each run writes one set, stamped with the same UTC time:

| File | Contents |
|---|---|
| `cohory-<stamp>.dump` | `pg_dump` in custom format of the whole database, including queued jobs. The script checks it with `pg_restore --list` before keeping it. |
| `cohory-<stamp>-uploads.tar.gz` | The uploads volume (`<project>_uploads`). Skipped when the volume does not exist, for example with `STORAGE_DRIVER=s3`; back up the bucket with your provider's tools instead. |
| `cohory-<stamp>.sha256` | SHA-256 checksums of the two files. |

`BACKUP_KEEP` (default 7) is the number of sets to keep in the folder; older sets are deleted after a successful run. Both scripts use the usual Compose variables: with the production overlay, set `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`, and set `COMPOSE_PROJECT_NAME` when the project is not called `cohory`. Both can live in `.env`; the scripts ask `docker compose config` for the project name, so they back up and restore the same stack as your `docker compose` commands. The database runs inside its container, so the host needs only Docker.

The backup holds every member's data and the encrypted Stripe keys of creators. Store it like a password: copy it off the server (for example with `rsync` or `restic` to another machine or bucket) and keep `.env` (it holds `PAYMENTS_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`) in a separate, safe place. Without the encryption key, restored Stripe keys cannot be read.

Run it daily from cron:

```
15 3 * * * cd /opt/cohory && COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml scripts/backup.sh /srv/cohory-backups >> /var/log/cohory-backup.log 2>&1
```

### Restore

Restore into a fresh stack, for example on a new server after copying the repository, `.env`, and the backup files:

```sh
scripts/restore.sh backups/cohory-20261018T121415Z.dump
```

The script starts `postgres`, refuses to continue when the database already has tables (exit code 3), creates the application role if it is missing, runs `pg_restore`, empties and unpacks the uploads volume from the archive next to the dump (or the one given as the second argument), and then starts `migrations`, `web`, and `worker`. Migrations then bring an older backup up to the current schema and set the application role's password from `POSTGRES_APP_PASSWORD`.

To replace a database that has data, pass `--force`. It stops `web` and `worker`, drops and recreates the database, and replaces the uploads. Everything written since the backup is lost, so take a fresh backup first.

How it was tested (0.2.0, on a laptop with Docker Desktop): seed a stack, create a post and upload an image through the API, back up three times with `BACKUP_KEEP=2` (the oldest set was removed), run `docker compose down -v`, restore into the empty project, then sign in as the old owner, read the post, and download the image with the same SHA-256 as before. A second restore into the running stack stopped with exit code 3, and `--force` removed a post written after the backup. Test your own restore on a spare machine before you need it.

## Upgrading

1. Take a backup: `scripts/backup.sh` (see [Backups](#backups)).
2. Get the new version: `git pull` (or check out a release tag).
3. Rebuild and restart: `docker compose up -d --build`.

Compose runs `migrations` first. If it fails, `web` and `worker` do not start; read `docker compose logs migrations`, fix the cause, and run `docker compose up -d` again. Release notes will list any manual step.

Once images are published (the `Docker` workflow in `.github/workflows/docker.yml` pushes them to GitHub Container Registry when a release tag such as `v0.1.0` is pushed, with the tags listed in [open-source/release-strategy.md](open-source/release-strategy.md)), upgrades will become: set `COHORY_IMAGE` and `COHORY_VERSION` in `.env`, then `docker compose pull` and `docker compose up -d`. Pin an exact version or a minor tag, never `latest` or `edge`.

Migrations are forward only, so an upgrade never needs a down step, and going back to an older version means restoring the backup from step 1.

### How the upgrade path is tested

`scripts/upgrade-check.sh` (run in CI by the `E2E` workflow) simulates an older install and upgrades it:

1. It starts an empty PostgreSQL in its own Compose project (`cohoryupgrade`, host port `127.0.0.1:55311`), so it never touches your stack.
2. It applies migrations only up to `UPGRADE_FROM` (default `0004`, the migration that added posts) and inserts an account, a public community, an owner membership, and a post the way that schema stored them.
3. It starts the current `migrations`, `web`, and `worker` services on that database, then runs the seed.
4. It checks that `/api/v1/health` returns ok, that every migration is applied, that the old community is readable through the API, that the old account signs in and sees its post, and that the application role reads the post under row level security.
5. It removes the project and its volumes.

Run it yourself before a risky upgrade, from the repository root with Docker and pnpm installed:

```sh
pnpm install
UPGRADE_FROM=0004 bash scripts/upgrade-check.sh
```

It ends with a `PASS` line, or prints `FAIL` with the reason and the last migration and web logs.

## Rate limits

cohory limits how often one client can repeat sensitive or public writes. A refused request gets HTTP 429 with a `Retry-After` header, and the web app shows "You're doing that too often" with the wait time.

| Action | Counted per | Default (max per window) | Variable |
|---|---|---|---|
| Sign up | client address | 5 per 10 minutes | `RATE_LIMIT_SIGN_UP` |
| Sign in | client address | 10 per minute | `RATE_LIMIT_SIGN_IN` |
| Failed sign in | account (email) | 50 per 15 minutes | `RATE_LIMIT_SIGN_IN_ACCOUNT` |
| Password reset request and reset | client address | 5 per 10 minutes | `RATE_LIMIT_PASSWORD_RESET` |
| Create an invite link | member | 30 per hour | `RATE_LIMIT_INVITE_CREATE` |
| Redeem an invite link | member | 10 per 10 minutes | `RATE_LIMIT_INVITE_REDEEM` |
| New post | member | 10 per minute | `RATE_LIMIT_POSTS` |
| New comment | member | 30 per minute | `RATE_LIMIT_COMMENTS` |
| Like or unlike | member | 120 per minute | `RATE_LIMIT_REACTIONS` |
| RSVP | member | 30 per minute | `RATE_LIMIT_RSVPS` |
| Request to join | member (`user:<id>`), counted in the manage service, so every surface shares it | 10 per 10 minutes | `RATE_LIMIT_JOIN_REQUESTS` |
| Community search | member (`user:<id>`) or client address (`ip:<address>`), the same bucket on the web page and the REST route | 30 per minute | `RATE_LIMIT_SEARCH` |
| Report a post or comment | member | 10 per 10 minutes | `RATE_LIMIT_REPORTS` |
| Upload an archive or Skool and Circle files for a preview | owner | 50 per hour | `RATE_LIMIT_MIGRATION_PREVIEWS` |
| Start an import after the preview | owner | 10 per hour | `RATE_LIMIT_MIGRATION_IMPORTS` |
| Upload a members CSV | owner | 20 per hour | `RATE_LIMIT_MEMBER_IMPORTS` |
| Any request with a personal API token | token | 60 per minute | `RATE_LIMIT_API_TOKENS` |
| Any request with an agent token | agent | 30 per minute | `RATE_LIMIT_AGENT_REQUESTS` |
| Writes by an agent | agent | 30 per hour | `RATE_LIMIT_AGENT_WRITES` |
| Register an OAuth client (`/oauth/register`) | client address | 10 per hour | `RATE_LIMIT_OAUTH_REGISTER` |
| OAuth token and revocation requests | client address | 30 per minute | `RATE_LIMIT_OAUTH_TOKEN` |
| Agent file and skill downloads through signed links | client address | 30 per minute | `RATE_LIMIT_AGENT_DOWNLOADS` |
| Regenerate an API or agent token | person | 10 per hour | `RATE_LIMIT_TOKEN_REGENERATE` |
| Stop community emails from the opt out page or the one click link | client address | 10 per 10 minutes | `RATE_LIMIT_EMAIL_OPT_OUT` |
| Bounce and complaint webhook (`/api/webhooks/email`) | client address | 60 per minute | `RATE_LIMIT_EMAIL_WEBHOOK` |
| Download your data (`/account/data-export/{id}`) | account | 10 per hour | `RATE_LIMIT_DATA_EXPORT_DOWNLOADS` |
| Contact form (`/contact`) | client address | 5 per hour and 20 per day | `RATE_LIMIT_CONTACT_IP_HOUR`, `RATE_LIMIT_CONTACT_IP_DAY` |
| Contact form (`/contact`) while signed in | account | 10 per day | `RATE_LIMIT_CONTACT_ACCOUNT` |
| Early access form (`/early-access`, Cloud) | client address, and account when signed in | the contact form values, counted separately | `RATE_LIMIT_CONTACT_*` |

Set a variable in `.env` as `max/seconds`, for example `RATE_LIMIT_POSTS=20/60`. A malformed value stops the app at the first request that needs it, so typos do not silently remove a limit. `RATE_LIMIT_DISABLED=true` turns every limit off; use it only for automated test runs.

Counters live in the memory of each web process and reset when it restarts. That needs no Redis and is enough for the single web container that Compose runs. If you run several web containers behind a load balancer, each one counts on its own, so the effective limit is the configured value times the number of containers. The client address comes from the last `X-Forwarded-For` entry, the one your reverse proxy appends, so entries a client sends itself do not count. Addresses are counted in canonical form, an IPv4 mapped IPv6 address counts as its IPv4 address, and every IPv6 address in one /64 network counts as one client. The proxy must set that header (see below) and the app must not be reachable around the proxy, otherwise a client can pick its own address.

## Fair use limits

Fair use limits cap what one community can use: active members, file storage, and the size of one upload. On the Community Edition there are no limits unless you set them. The Cloud Edition starts from the limits published in [foundation/business-model.md](foundation/business-model.md).

| Limit | Community Edition default | Cloud, no paid plan | Cloud, paid plan | Variable (paid variant) |
|---|---|---|---|---|
| Active members | unlimited | 1,000 | unlimited | `FAIR_USE_MEMBERS` (`FAIR_USE_PAID_MEMBERS`) |
| File storage in bytes | unlimited | 5 GB (5368709120) | 50 GB (53687091200) | `FAIR_USE_STORAGE_BYTES` (`FAIR_USE_PAID_STORAGE_BYTES`) |
| One upload in bytes | unlimited | 500 MB (524288000) | 2 GB (2147483648) | `FAIR_USE_UPLOAD_BYTES` (`FAIR_USE_PAID_UPLOAD_BYTES`) |

Set a value in `.env` as a whole number or `unlimited`. A malformed value (for example `5GB` or `0`) stops the app at the first request that needs it, so a typo never removes a limit silently. On the Community Edition the `FAIR_USE_PAID_*` values fall back to the `FAIR_USE_*` values, so one line caps every community.

How limits apply:

- A community counts as "paid plan" when it had a paid transaction in the last 90 days: a member payment with a positive amount after refunds, or a collected or accrued platform fee entry on a payment that was not refunded in full. A price alone does not count. Manage, Overview says which limits apply.
- Members: joining an open community or redeeming an invite link is refused once the active member count reaches the limit. Existing members are never removed, and people who are already members can still use the invite link.
- Storage: post images, lesson attachments, logos, and covers are refused when the file would take the community over its storage limit, or when the file is larger than the upload limit. Avatars belong to the account, not a community: each person has one avatar of at most 5 MB, replaced on every change, and it counts toward no community. Storage used is the size of everything under the community's folder (`communities/<id>/`) in the storage driver, computed when it is needed, so on S3 it costs one listing request per 1,000 files.
- Uploads also stay bound by `STORAGE_MAX_UPLOAD_BYTES` and the per type limits (25 MB for attachments), whichever is lower.
- A refused action gets HTTP 409 with code `limit_reached`, the resource, the limit, and the amount used, and the app shows a plain message such as "This community has reached its limit of 1,000 members, so it can't take new members right now."
- Admins and owners see used versus limit in Manage, Overview, Usage, and through `GET /api/v1/communities/{slug}/manage/usage`.
- Two people joining at the same moment can both pass the check, so a community can end one or two members above its limit. The limit is a fair use guard, not a hard quota.

## Email

The app sends account email (sign up confirmation, password reset) and community email (notifications, invitations, event reminders, membership changes) through one SMTP server. Any provider with SMTP works; Mailpit (profile `mail`) catches everything for testing.

Without an SMTP server, nobody can confirm an email address, so the app does not require it. Anything that trusts an address then trusts whoever signs up with it. In particular, the free time on the Paying members to move list ([payment migration](operations/payment-migration.md#option-c-subscribe-again-with-free-time)) goes to whoever signs up first with a listed address. Configure SMTP before you use that list, or list only addresses you trust with short dates.

### Sender identity

Every email leaves from the one address in `SMTP_FROM`. Only the address is used; the sender name comes from the content:

| Email | From |
|---|---|
| Account email | `{INSTANCE_NAME} <SMTP_FROM>`, for example `Makers Hub <no-reply@community.example.com>` |
| Community email | `{community} via {INSTANCE_NAME} <SMTP_FROM>`, for example `Design Club via Makers Hub <no-reply@community.example.com>` |

A creator's own address is never put in From, because your domain cannot sign for it. Set `SMTP_REPLY_TO` to send replies to a support inbox. Each email gets a Message-ID on the `APP_URL` host. Community email subjects start with `[{community}]`; account email subjects do not.

With `NODE_ENV=production`, the app refuses to send when the `SMTP_FROM` domain is not the `APP_URL` host, its parent domain, or one of its subdomains. For `APP_URL=https://community.example.com`, `no-reply@community.example.com` and `no-reply@example.com` both work, and `no-reply@localhost` or `no-reply@gmail.com` make every send fail with an error that names both domains. The web app and the worker log the same error when they start, and keep running. The check is skipped when `APP_URL` is a loopback address such as `http://localhost:3000`, so a local stack sends to Mailpit with any sender. If your provider signs another domain with DKIM, set `EMAIL_ALLOW_ANY_FROM=true`.

### SPF, DKIM, and DMARC

Gmail and Yahoo reject or spam mail from domains that do not authenticate. Add these DNS records for the `SMTP_FROM` domain. Your provider shows the exact values.

1. SPF: one TXT record on the domain that lists your provider, for example `v=spf1 include:_spf.provider.example ~all`. Keep a single SPF record; merge providers into it.
2. DKIM: the TXT or CNAME records your provider gives you, usually at `{selector}._domainkey.example.com`. Turn on signing in the provider's dashboard.
3. DMARC: a TXT record at `_dmarc.example.com`. Start with `v=DMARC1; p=none; rua=mailto:dmarc@example.com` to collect reports, then move to `p=quarantine` once the reports show your mail passes.

Check the result by sending yourself a test email (below) to a Gmail address and opening "Show original": SPF, DKIM, and DMARC should all say `PASS`.

### TLS

| Variable | Default | Effect |
|---|---|---|
| `SMTP_SECURE` | `true` on port 465, `false` elsewhere | TLS from the first byte |
| `SMTP_REQUIRE_TLS` | `false` | Refuse to send unless the server upgrades the connection with STARTTLS. Set `true` on port 587 so a downgrade cannot send your password in clear |

### Test command and send log

From a checkout of the repository with dependencies installed (`pnpm install`) and the same `.env` as the app:

```sh
pnpm email:test you@example.com
```

It sends one email through the configured driver and prints `Sent a test email to you@example.com through SMTP smtp.provider.example:587.`, or the error code and reason and exits with code 1. The `mail` profile publishes Mailpit's SMTP port on `127.0.0.1:1025` (`MAILPIT_SMTP_PORT`), so to try the command against Mailpit from the host, run it with `SMTP_HOST=localhost`.

Every send is recorded in the `email_log` table: template, a SHA-256 hash of the recipient address (never the address), `sent`, `failed`, or `suppressed`, an error code such as `EAUTH`, `smtp_550`, or the suppression reason, and the time. Read it as the database owner:

```sh
docker compose exec postgres psql -U cohory -c \
  "select created_at, template, status, error_code from email_log order by created_at desc limit 20"
```

To find one person's email, compare with `encode(sha256(convert_to(lower('ada@example.com'), 'UTF8')), 'hex')`. The app has no screen for the log yet.

### Sending rate

SMTP keeps a pool of up to `EMAIL_MAX_CONNECTIONS` connections (default 3) and sends at most `EMAIL_RATE_PER_SECOND` emails per second per process (default 10). The web app and the worker each have their own pool, so the provider sees at most twice the rate. Set the rate below your provider's limit. Member imports send their emails from the worker through the same pool.

### Bounces, complaints, and opt outs

The `email_suppressions` table lists addresses (as SHA-256 hashes) that get no more email. Every send goes through it ([0035](decisions/0035-email-suppression-and-delivery-headers.md)):

| Entry | Effect |
|---|---|
| Instance wide (`hard_bounce`, `complaint`, `manual`) | No email to the address at all, except security email |
| Per community (`opt_out`, or `manual` with a community) | No email about that community |

Security email always goes out: email confirmation, password reset, sign in links, both change of email emails, the notice sent when someone signs up with an address that already has an account, and the notices that a password was changed or removed. A person must always be able to get back into their account.

Entries come from four places:

1. Your SMTP server: a reply that says the mailbox is dead adds a `hard_bounce`: enhanced status `5.1.x` (such as `5.1.1` user unknown) or `5.2.1` (mailbox disabled), or, when the server sends no enhanced code, a bare 550, 551, or 553 to `RCPT TO`. Relay denied, IP blocklist, and policy replies (`5.7.x`, `5.4.x`), failed logins, and temporary errors add nothing; fix those on your side.
2. People: invitations, "has moved" emails, and free access offers end with "Don't email me about {community}". The link opens a confirm page, and mail apps use the same URL as a one click unsubscribe. It adds an `opt_out` for that community.
3. You, from a checkout with the same `.env` as the app:

   ```sh
   pnpm email:suppress add ada@example.com                      # stop everything but security email
   pnpm email:suppress add ada@example.com --community <id>     # stop email about one community
   pnpm email:suppress check ada@example.com
   pnpm email:suppress remove ada@example.com                   # lift the instance wide entry
   ```

   The script prints the address masked (`a***@example.com`). `add` and `remove` write a row to `email_log` with template `suppression-added` or `suppression-removed` and `operator=<name>` as the error code. The name is `--actor <name>` or your system user name, so a lifted suppression always leaves a trace.

4. Your provider, through a signed webhook. Set `EMAIL_WEBHOOK_SECRET` (at least 32 characters) and send `POST /api/webhooks/email`:

   ```http
   POST /api/webhooks/email
   Content-Type: application/json
   Cohory-Signature: t=1792663200,v1=<hex HMAC-SHA256 of "1792663200.<raw body>" with EMAIL_WEBHOOK_SECRET>

   {"events":[{"type":"hard_bounce","email":"gone@example.com"},{"type":"complaint","email":"angry@example.com"}]}
   ```

   `type` is `hard_bounce` or `complaint`. Each event names `email` or `addressHash` (the SHA-256 hex of the lowercased address) and may add `communityId`. Up to 100 events and 64 KB per request; the timestamp must be within 5 minutes. Answers: 200 `{"recorded": n, "batchId": "<uuid>"}`, 401 for a missing, wrong, or old signature, 422 for a bad body, 404 when no secret is set. Sending the same event twice changes nothing. Each accepted event also writes a row to `email_log` with template `suppression-webhook` and `batch=<batchId>;n=<events in the request>` as the error code, so you can trace every webhook suppression back to its request. The route allows 60 requests per minute per client address (`RATE_LIMIT_EMAIL_WEBHOOK`); the opt out page and one click link allow 10 per 10 minutes (`RATE_LIMIT_EMAIL_OPT_OUT`). Cohory has no adapter for a particular provider yet; a small relay (for example a serverless function that receives SES, Postmark, or Resend events and signs them as above) connects one.

### Headers

Every email carries `Auto-Submitted: auto-generated`, so vacation replies stay away. Community notifications carry `List-Id: "{community}" <{slug}.{APP_URL host}>` for filters, and notifications about one post share `References` and `In-Reply-To`, so Apple Mail and Thunderbird group them in one thread. Notification emails carry `List-Unsubscribe` with one click `POST`; a `GET` on the same URL opens the confirm page.

## Reverse proxy and TLS

The base `docker-compose.yml` publishes `web` on `127.0.0.1:3000` only (set `APP_BIND` and `APP_PORT` to change that), so nothing is reachable from the network without a proxy in front. Changed in 0.2.0: before, `web` listened on all interfaces by default.

For a public server use the production overlay, which adds Caddy with automatic HTTPS:

```sh
cp .env.production.example .env   # then fill in DOMAIN, ACME_EMAIL, COHORY_VERSION, and the secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

What `docker-compose.prod.yml` changes:

| Area | Setting |
|---|---|
| TLS | Caddy 2.10.2 on ports 80 and 443 (`HTTP_BIND`, `HTTPS_BIND`) gets and renews a certificate for `DOMAIN` from Let's Encrypt, redirects HTTP to HTTPS, and keeps certificates in the `caddy_data` volume. The site lives in `docker/Caddyfile`. |
| Public URL | `APP_URL`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL` default to `https://$DOMAIN`. |
| Image | `web`, `worker`, and `migrations` run `${COHORY_IMAGE}:${COHORY_VERSION}`. Compose refuses to start without `COHORY_VERSION`. |
| Network | `web` and `postgres` publish no host ports; only Caddy is reachable. |
| Resources | Memory limits from REQ-NFR-HOST-002: web 1 GB, worker 512 MB, PostgreSQL 1 GB, Caddy 256 MB (`WEB_MEMORY_LIMIT` and friends). |
| Restarts | `restart: unless-stopped` on every long running service. |
| Logs | `json-file` logs rotated at 10 MB, 5 files per container (`LOG_MAX_SIZE`, `LOG_MAX_FILE`). |
| Health | Healthchecks on `postgres`, `web` (`/api/v1/health`, which checks configuration and the database), `worker` (its heartbeat file), and `caddy` (its admin endpoint). Caddy waits for `web` to be healthy. |

Caddy replaces any `X-Forwarded-For` header the client sent with the address it sees, and sets `X-Forwarded-Proto` and `X-Forwarded-Host` (host and port, so a site on a port other than 443 still passes the Next.js origin check for server actions). The rate limiter reads the last `X-Forwarded-For` entry, so this is what makes per address limits count the real client. If you use another proxy instead, it must append the client address itself (and drop or overwrite what the client sent), forward `Host`, allow request bodies of at least 30 MB, and not buffer streaming responses. Never expose `web` directly while it trusts forwarded headers.

The overlay needs Docker Compose 2.24 or newer (it uses `!reset` to remove ports). The full walkthrough is in [operations/install.md](operations/install.md).

## Resource expectations

The reference size is 2 vCPU and 4 GB of RAM for one community (REQ-NFR-HOST-001). The app image is about 330 MB. Database size grows with members, posts, and job history; uploads grow with what members attach.
