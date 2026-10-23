# 0035. Email suppression list, throttled SMTP, and list and thread headers

One provider independent suppression list sits in the shared mailer, so every email path skips bounced, complaining, and opted out addresses except the security email a person asks for. SMTP sends through a throttled pool, every email is marked automatic, and community notifications carry list and thread headers.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner (founder decision, 2026-10-22)
- Related: [../self-hosting.md](../self-hosting.md) section Email, [../architecture/data-model.md](../architecture/data-model.md) (`email_suppressions`, `email_log`), [../product/backlog.md](../product/backlog.md) (HTTP email provider adapter)

## Context

The email review (2026-10-21) found that nothing handled bounces or complaints, so a dead or complaining address kept receiving every notification, invitation, and reminder. Imports of thousands of members opened one SMTP connection per message with no rate. Invitations and "has moved" emails went to people who never signed up, without a way to stop them. The notification List-Unsubscribe URL answered 404 to GET, vacation replies came back to the sender, and each notification started a new thread.

Product decision 15 asks for a provider agnostic suppression list fed by SMTP, an operator entry point, and a signed generic webhook; provider specific webhooks wait in the backlog. Two other units change email at the same time: one adds notification emails, one moves account email onto a retried `email.send` job. Both end in the same mailer.

## Decision

1. **Where the check runs.** `getMailer()` in `@cohory/email` wraps the driver as `withSuppression(withEmailLog(driver))`. Every path that sends through `sendEmail` or `getMailer`, today and later, gets the check once, including the `email.send` job, which the worker delivers through `getMailer()`. Queued emails may carry `communityId` and `headers`, so a community opt out and List-Unsubscribe survive the queue. A suppressed send returns without error, so callers never retry it, and `email_log` records it with status `suppressed` and the reason as the error code.
2. **Scope.** A row with no community stops all email to the address. A row with a community stops only messages that carry that `communityId`. `EmailMessage` gains an optional `communityId`; notifications, import invitations, moved emails, members added from a CSV, and free access offers set it.
3. **Security email is exempt.** The templates `email-verification`, `password-reset`, `magic-link`, `change-email-verification`, `change-email-confirmation`, `existing-account-sign-up`, `password-changed`, and `password-removed` are always sent. The first six are what a person asks for to reach their own account (`existing-account-sign-up` is the reply to signing up with an address that already has an account, and stands in for the verification email); the last two warn the owner about a change to the account, which a suppression must never hide. The exemption keys on the template id, which every template sets; a test fails if one of these templates changes its id.
4. **Feeds.**
   - SMTP: a 5xx reply adds an instance wide `hard_bounce` from source `smtp` only when it says the mailbox is dead. With an enhanced status code, that is `5.1.x` (bad address) or `5.2.1` (mailbox disabled); `5.7.x` (relay denied, IP blocklists, policy) and `5.4.x` never suppress, because they describe the sender, not the address. Without an enhanced code, a bare 550, 551, or 553 reply to `RCPT TO` counts. After a suppression the send resolves, because retrying cannot deliver it. Every other failure throws as before and suppresses nothing.
   - Webhook: `POST /api/webhooks/email` with `Cohory-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">` under `EMAIL_WEBHOOK_SECRET`, a 5 minute tolerance, and a 64 KB limit. The body is `{ "events": [{ "type": "hard_bounce" | "complaint", "email" or "addressHash", "communityId"? }] }`, 1 to 100 events. Without a secret the route answers 404. Adding is idempotent, so a replayed body changes nothing. Each request gets a server generated batch id, returned in the response, and each event writes an `email_log` row (template `suppression-webhook`, error code `batch=<id>;n=<count>`). The route is rate limited per client address (`RATE_LIMIT_EMAIL_WEBHOOK`, 60 per minute).
   - Operator: `pnpm email:suppress add|remove|check you@example.com [--community <id>] [--actor <name>]`. The script masks the address in its output. `add` and `remove` write an `email_log` row (template `suppression-added` or `suppression-removed`, error code `operator=<name>`, the name from `--actor` or the system user), so a lifted suppression leaves a trace. The audit uses `email_log` instead of a new table; its status column reads `suppressed` for these rows and the template tells them apart.
   - Member: the opt out link (item 6).
5. **Throttle.** SMTP uses a nodemailer pool with `EMAIL_MAX_CONNECTIONS` (default 3) and `EMAIL_RATE_PER_SECOND` (default 10). Imports already run as pg-boss jobs in batches with a per person marker, so the pooled, rate limited transport throttles them without a second queue; one hard bounce no longer stops an import.
6. **Opt out from first contact email.** Import invitations, moved emails, and free access offers say who invited the person and from which list, and link "Don't email me about {community}" to `/email-opt-out?token=`. The token is HMAC signed with a key derived from `BETTER_AUTH_SECRET`, holds only the address hash and the community, and is valid for a year. The page asks before it acts, because mail scanners open links. The page action and the one click route share a per client address rate limit (`RATE_LIMIT_EMAIL_OPT_OUT`, 10 per 10 minutes). The same token serves one click `POST /api/email-opt-out` in `List-Unsubscribe`; GET on that URL opens the page.
7. **Headers.** Every email carries `Auto-Submitted: auto-generated` (RFC 3834) and `X-Auto-Response-Suppress: OOF, AutoReply`. Community notifications carry `List-Id: "{community}" <{slug}.{APP_URL host}>`. Notifications about a post carry `References` and `In-Reply-To` of `<post-{postId}@{APP_URL host}>`, with a unique Message-ID per email. GET on the notification List-Unsubscribe URL answers 303 to `/unsubscribe?token=`; POST stays the one click action.

## Consequences

- Any new email path inherits suppression and the automatic headers by using `sendEmail` or `getMailer`. A path that builds its own transport bypasses both.
- An account emailed security mail at a bounced address still gets it; this is by design.
- Apple Mail and Thunderbird thread notifications per post now. Gmail also needs the same subject, which the notification subjects do not have yet; stable per post subjects come with the notification content work that adds the post title.
- A suppressed import invitation still counts as sent in the import summary, because `Mailer.send` reports no outcome.
- Provider specific bounce webhooks (SES, Postmark, Resend) stay in the backlog. An operator can relay them to the generic webhook.

## Alternatives considered

- Check suppression in each caller: rejected, every new path would need to remember it, and two units add paths in parallel.
- Throw on a suppressed send: rejected, notification delivery and the coming `email.send` job retry thrown sends.
- A per email pg-boss queue for imports: rejected for now, the import job already batches and records progress, and the account email queue belongs to another unit.
