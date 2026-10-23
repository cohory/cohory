# Moving from Cloud to self hosted

How a creator moves a community from cohory Cloud to their own server: export the archive, install the Community Edition, import, and switch payments and the domain (REQ-MIG-006, journey 12).

Status: Draft, 2026-10-18

Moving data is built and tested: the archive export, the import into an empty community, and the command line tools below. Linking existing Stripe subscriptions on the new server is built as well (section 5). The archive layout is in [../architecture/archive-format.md](../architecture/archive-format.md).

## 1. What moves and what does not

| Moves | Does not move |
|---|---|
| Community settings, appearance, logo and cover, join questions, level names | Passwords, sessions, sign in with other providers |
| Members with their roles, bios, join answers, bans, and pending join requests | Avatars (members upload them again) |
| Posts, comments, replies, likes, post images | Notifications and notification preferences |
| Courses, modules, lessons, attachments, lesson progress | The Stripe connection and its keys |
| Events, occurrences, RSVPs | Payments history and the platform fee ledger (Stripe keeps the record) |
| Points ledger, totals, and levels | Content reports |
| Comped access, invite links, the audit log | |
| A summary of the plan and each subscription with its Stripe ids | |

People are matched by email. On a Community Edition server, anyone who has no account there gets one without a password. When you confirm the import you choose whether to email them now, later from Import history, or not at all; the email has a link to choose a password that works for 7 days, and anyone can still use "Forgot password". On Cloud every imported person gets an invitation instead ([0043](../decisions/0043-import-invitations-and-emails.md)).

## 2. Before you start

1. Tell members the date. Sessions do not move, so everyone signs in again on the new server.
2. Install the Community Edition on your server with [install.md](install.md). Use a temporary domain while you test.
3. Sign up on the new server with the same email you use on Cloud. You stay the owner when the emails match; otherwise the old owner account is imported as an admin and you stay the owner.

## 3. Export on Cloud

1. Open Manage, Migration.
2. Press Start export. The worker builds the archive; the card shows progress and then Download latest archive.
3. Download the zip and keep it private. It holds every member's email address.

Archives are kept in the server's storage under `migration/<community id>/exports/` (there is no delete button yet). Every export is written to the audit log as `migration.export`.

## 4. Import on the new server

You can import in the browser or on the command line.

**In the browser.**

1. Create a new community. Its URL can differ from the old one; the import keeps the URL you chose and takes the name and settings from the archive.
2. Open Manage, Migration, Import archive, and choose the zip. The server checks the manifest, the format version, every checksum, and every line before anything changes, and shows what will move.
3. Choose whether to email new accounts a link to choose a password, then press Import everything.
4. The card shows progress and then the result: counts, accounts created and linked, and anything skipped with a reason.

Import only works into an empty community: no posts, courses, events, or members other than you. If an import stops, press Try again. It continues where it stopped and does not create duplicates.

**On the command line.** Copy the archive to the server, then run the import in the worker container, which has the command built in:

```sh
docker compose cp ./my-community.zip worker:/tmp/archive.zip
docker compose exec worker node apps/worker/dist/migration-cli.js import --file /tmp/archive.zip --notify
```

Without `--slug`, the command uses the slug from the archive and creates the community if no community has that slug, owned by the person who owned it in the archive (an account is created for them if needed). Pass `--slug <slug>` to use another URL and `--owner-email <email>` to choose the owner. An existing community with that slug must be empty. The command prints a JSON summary.

To export on a self hosted server:

```sh
docker compose exec worker node apps/worker/dist/migration-cli.js export --slug my-community --out /tmp/archive.zip
docker compose cp worker:/tmp/archive.zip ./my-community.zip
```

In a development checkout, `pnpm migration export --slug <slug> --out <file.zip>` and `pnpm migration import --file <file.zip>` run the same commands against the database in `.env`.

Archives up to `MIGRATION_ARCHIVE_MAX_BYTES` (512 MiB by default) are accepted. The worker builds and reads them in memory, so leave about twice that much free memory.

## 5. Payments

Members' subscriptions and saved cards live in your Stripe account, not in cohory, so they keep billing while you move.

What the import does today:

- Each active or past due subscription becomes free access for that member, with a note naming the Stripe subscription id. Members keep their access and pay nothing twice. The access has no end date unless the subscription was set to cancel at the period end.
- The plan is not recreated, because a plan needs a connected Stripe account. The import result lists it.
- The archive keeps each subscription's Stripe customer id and subscription id for the link step.

What you do:

1. On the new server, connect the same Stripe account with your own API keys (Manage, Payments) and create the plan again.
2. Open Manage, Migration, "Bring your existing subscribers" (or the same card on Manage, Payments). cohory lists the subscriptions on the connected account, matches them to members by confirmed email, and links them without any action from the members. The free access from the import stays until you end it in Manage, Payments, Free access; a linked subscription grants access on its own. The options, including what to do when the subscriptions live in another Stripe account, are in [payment-migration.md](payment-migration.md).
3. On Cloud, open Manage, Payments and choose Disconnect Stripe. Keep "Take my members with me" so subscriptions keep billing in your Stripe account, and paste your Stripe customer portal login link if you want members to get it in their email (it starts with `https://billing.stripe.com/p/login/`). Cloud first removes the application fee from every subscription and checks it, then closes the connection, then tells each member that you bill them directly now, with your email as the contact. While it works, Manage, Payments shows Disconnecting and new memberships are paused. If Stripe refuses the change for some subscriptions, the page names those members with Try again and Disconnect anyway; after Disconnect anyway, remove the fee from those subscriptions in your Stripe Dashboard. Cloud refunds any platform fee it receives after you leave. See [../architecture/payments.md](../architecture/payments.md) section 13.8.
4. Paid access on Cloud ends at the end of each member's current period. Link the subscriptions on the new server (step 2) before then so members keep access there.

If your Stripe account was created by Cloud through Connect and you cannot use its API keys directly, members may have to subscribe again on the new server. Check this before the move day.

## 6. Switch the domain

1. Point your DNS record at the new server and set `APP_URL` in `.env` to the final address ([operator-guide.md](operator-guide.md)).
2. If you emailed new accounts, the links point at `APP_URL`, so set it before the import.
3. Archive the community on Cloud (Manage, Settings, Danger zone) once members are on the new server.

## Decisions and open questions

- **Recommendation:** paying members get free access until their Stripe subscription is linked, so nobody loses access or pays twice.
- **Recommendation:** import only into an empty community, keeping the slug the owner chose.
- **Open question:** whether a later archive version carries password hashes so members keep their passwords.
- **Open question:** how a creator whose Stripe account is only reachable through Cloud's Connect platform keeps existing subscriptions.
