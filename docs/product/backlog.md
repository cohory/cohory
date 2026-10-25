# Backlog

Every open or deferred item that the current build leaves for later, grouped by area, with why it is open and any human gate it waits on. Resolved questions are in [decisions-log.md](decisions-log.md).

None of these blocks a self-hosted install. A "human gate" is a step that needs a person with an account, a credential, or a legal or accounting role; no engineering change closes it.

## Release and operations gates

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Tag and push releases | Releases are tagged and images published by a person. | Maintainer release | [release-strategy.md](../open-source/release-strategy.md) |
| VPS install and load test | The load test ran on a laptop, not on the reference VPS with a public domain and TLS. | Install on a VPS with a public domain | [load-test.md](../operations/load-test.md), [install.md](../operations/install.md) |
| External security review | The reviews so far are internal. | Independent reviewer | [review-2026-10.md](../security/review-2026-10.md), [review-agent-courses.md](../security/review-agent-courses.md) |
| Silent secrets rotation without a payments key | `pnpm secrets rotate` prints `"payments": null` and exits 0 when stored payment secrets exist but neither `PAYMENTS_ENCRYPTION_KEY` nor `PAYMENTS_ENCRYPTION_KEYS` is set; it should fail. | None | `apps/worker/src/secrets-cli.ts` |
| Webhook key derived from `BETTER_AUTH_SECRET` cannot be retired | The derived key always joins the webhook keyring, so rotating `BETTER_AUTH_SECRET` needs the old derived key listed by hand, and it never leaves the ring while the secret stays. | None | `packages/webhooks/src/env.ts`, [operator-guide.md](../operations/operator-guide.md) |

## Payments and billing

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Stripe hosted onboarding by hand | The hosted onboarding form sits behind a captcha, so automation cannot complete it. The release check needs one run in the sandbox and one in live mode that confirms `account.updated` sets `charges_enabled`. | Person in the Stripe dashboard | [payments.md](../architecture/payments.md) section 12.7 |
| Hosted invoice page payment | Paying a platform invoice on Stripe's hosted page could not be automated because of a captcha; the sandbox pays invoices through the API. | Manual payment in the release check | [payments.md](../architecture/payments.md) section 12.12 |
| Remove the Polar provider code | Polar is off by default since Step 18 because its [acceptable use policy](https://polar.sh/docs/merchant-of-record/acceptable-use) does not allow marketplaces or community access. The adapter, the fee accrual path, the fake Polar server, and the `polar` enum value stay until a decision to remove them. | Founder decision | [ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md), [payment-providers.md](../operations/payment-providers.md) |
| Polar live sandbox run | The Polar adapter is verified with recorded fixtures and a fake Polar server, not a real Polar sandbox. | Person with a Polar sandbox account | [payment-providers.md](../operations/payment-providers.md) |
| Polar `refunded_amount` and tax | Cohory assumes `refunded_amount` excludes tax and reverses the fee in proportion to the net refund. Needs a taxed order and a partial refund in the Polar sandbox. | Polar sandbox run | [payments.md](../architecture/payments.md) section 12.13 |
| Tax on platform fee invoices | Platform invoices carry no tax lines. Deferred until Cloud revenue (founder decision F-04). | Tax registration and an accounting decision before Cloud revenue | [platform-billing.md](../operations/platform-billing.md) |
| Operator billing screen | Operators use `pnpm billing` to run, sync, void, and resend invoices; there is no screen. | None | [platform-billing.md](../operations/platform-billing.md) |
| Pause end and first invoice on a test clock | Pause and resume are verified against the fake gateway, not a real Stripe subscription. Someone should pause a test clock subscription, advance the clock past `resumes_at`, and check that payments start again and the first invoice after the pause is right. | Person with a Stripe sandbox | [payment-providers.md](../operations/payment-providers.md), [payments.md](../architecture/payments.md) section 12.19 |
| "Paused until" from Stripe | The pause end lives only in Stripe (`pause_collection.resumes_at`), so the Membership page shows the date only right after pausing. Mirroring `resumes_at` on the subscription row would let it show the date every time. | None | [payments.md](../architecture/payments.md) section 12.19 |
| Invite use after staff removes a pending member or the account is purged | When staff removes a pending membership that holds an invite, or the account is purged, the hold is cleared without giving the invite use back. The fix belongs in the Communities removal and the account purge, not in Payments. | None | [payments.md](../architecture/payments.md) section 12.19 |
| Test clock subscriptions | Stripe leaves test clock subscriptions out of `subscriptions.list`, so "Bring your existing subscribers" does not show them in sandboxes. Only sandboxes are affected; the testing guide notes it. | None | [payments.md](../architecture/payments.md) section 12.10 |
| Moving offers and link invitations of erased people outside their communities | Account erasure deletes `subscriber_moves` rows and clears `subscription_links` emails only in communities the person belongs to. Rows for an address in a community they never joined stay until the retention job (moves) or forever (unclaimed links). An `app.account_purge` policy keyed by email needs a migration. | Migration owner | [0042](../decisions/0042-moving-paying-members.md) open questions |
| Query cost of ending free memberships on large pastes | On the Community Edition each dated row of a paste (up to 1,000) runs several lookups to decide whether to grant or move a comp. A set based query would make large pastes cheaper. | None | `packages/payments/src/service/moves.ts` |
| Stripe webhook failures log only `Error` | A failing `account.updated` (seen for an account created through Accounts v1, which Cohory reads through Accounts v2) logs `"error":"Error"` without the Stripe error code, so operators cannot tell why Stripe retries. | None | `packages/payments/src/service/webhooks.ts` |
| Fee taken on tax | `application_fee_percent` and the fee base use the full charge including tax, while the business model takes the fee on the pre tax amount. An `invoice.created` handler that sets the fee from `total_excluding_tax` is over a day of work and only matters once Stripe Tax is on. | None | `packages/payments/src/service/normalized-events.ts` |
| Dispute notice for unrecorded payments | A dispute on a payment Cohory never recorded (for example a charge from before a subscription was linked) is logged and still refunds the fee when lost, but the owner gets no notice, because the once only notice is keyed on the payment row ([ADR 0028](../decisions/0028-stripe-disputes.md)). | None | `packages/payments/src/service/disputes.ts` |
| Connect notification banner and integration identifier | Creators are not shown Stripe's embedded notification banner for new account requirements, and checkout passes no `integration_identifier`. The banner adds an external embedded component and Content Security Policy work. | None | `packages/payments/src/stripe-gateway.ts` |

## Legal and licensing

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| License plugin exception wording | The AGPL plugin exception is drafted but not legally reviewed. | Legal review | [ADR 0009](../decisions/0009-license.md), [LICENSING.md](../../LICENSING.md) |
| Agent course license presets | The personal, team, and custom presets (founder decision F-03) are not legally reviewed. | Legal review before Cloud sells agent access | [agent-courses-delegation.md](../operations/agent-courses-delegation.md) |
| Unconfirmed reporters look anonymous | The content report email does not tell the operator that a reporter was signed in but had not confirmed their address; it reads like an anonymous report. | None | `apps/web/lib/legal/report-delivery.ts` |

## Agents, API, and MCP

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Per agent auto approve | Every classified agent action waits for a person. An allowlist of low risk categories per agent is deferred (founder decision F-18). | None | [agent-integrations.md](../architecture/agent-integrations.md) section 5 |
| Per agent draft lifting | Agent posts are always drafts. Lifting this per agent and category is deferred (founder decision F-18). | None | [agent-integrations.md](../architecture/agent-integrations.md) section 5 |
| Cursor paging for approvals, drafts, invites, courses, and migration jobs | These lists return everything with `nextCursor: null` because they are bounded today; each needs a keyset cursor in its service when it grows ([ADR 0032](../decisions/0032-error-catalog-and-list-shape.md)). | None | `packages/api/src/pagination.ts` |
| Two factor authentication for approvals | Approvals need a sign in from the last 10 minutes; Cohory has no second factor yet. | None | [authorization.md](../architecture/authorization.md) section 8 |
| Revenue based rate limits | Every community gets the same token limits. Higher Cloud limits for communities with recent revenue, and owner raises, are not built. | None | [agent-integrations.md](../architecture/agent-integrations.md) section 8 |
| Client ID Metadata Documents | MCP revision 2026-07-28 recommends them; Cohory supports dynamic client registration only; registered clients nobody used for 30 days are deleted by a daily job (P18), so a client must register again after a long pause. Members still connect agents with tokens, since OAuth consent refuses plain members. | None | [ADR 0020](../decisions/0020-oauth-authorization-server.md), [mcp.md](../operations/mcp.md) |
| MCP resources and prompts | Only tools are offered. | None | [agent-integrations.md](../architecture/agent-integrations.md) section 4 |
| MCP revision 2026-07-28 extras | `subscriptions/listen`, multi round trip input requests, `x-mcp-header` parameters, and the tasks extension are not offered; no tool needs them. Moving to the official SDK once it speaks 2026-07-28 would drop `packages/mcp/src/modern.ts`. | None | [mcp.md](../operations/mcp.md#protocol-revisions) |
| Global job sweeps in tests | `expireDue` and similar sweeps act on every community, so clock moving integration suites could affect each other; the approvals suite uses a clock years in the past as a workaround. | None | `packages/agents/src/approvals/service.integration.test.ts` |
| Old approval requests for forbidden actions stay in the queue | Archive, deletion, and ownership transfer requests made before 0.9.0 now fail on approval with `not_allowed_for_agents`, but they stay pending in Approvals until they expire. | None | `packages/api/src/approvals/gateway.ts` |
| Erasure keeps grant and delegation rows | Erasing an account revokes its tokens and agents, but OAuth grants, refresh tokens, course delegations, and agent submissions keep rows that point at the Former member record. | None | `packages/identity/src/purge.ts` |
| Members connecting assistants through OAuth | The consent screen accepts only owners and admins, so a member who wants an assistant to read a course creates a read only agent and pastes its token. A founder decision (2026-10-22) keeps OAuth for creators and managers for now. | None | `packages/agents/src/oauth/consent.ts`, [mcp.md](../operations/mcp.md) |
| Clear approval alerts for every recipient | Deciding a request marks only the decider's own notice read. Notices of the other owners and admins stay unread, because notification rows may only be changed by their owner under row level security; clearing them needs a new policy and so a migration. | None | `packages/notifications/src/approvals.ts` |
| Agent icon on approval alerts | The bell shows the agent owner's avatar on an approval alert. An agent icon needs an actor kind on `NotificationItem` in `packages/ui`. | None | `packages/ui/src/notifications` |
| Request counts per day for agents and tokens | Account, Agents, Activity lists every change an agent or token made, but reads are not recorded anywhere, so per day request counts need a usage table and a migration. | None | `apps/web/app/(platform)/account/agents/activity` |
| Task titles in agent results | Agent results show the task id in words ("Write checklist") and the lesson title. The task title lives in the agent version's layer, which the entitlements submission views do not load yet. | None | `apps/web/lib/entitlements/load.ts` |
| Community time zone for approval summaries | Scheduled post approvals show the time in UTC with the zone named, because communities have no time zone setting; that needs a new column. | None | `packages/api/src/approvals/describe.ts` |

## Agent ready courses

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| What "verified" can mean | Results are self reported. Signed agent keys would prove origin only; correctness needs an execution environment Cohory controls or attests. | None | [evaluation-runner.md](../architecture/evaluation-runner.md) section 3 |
| Hosted execution | Out of scope: Cohory never runs scripts, templates, or evaluations. Needs its own decision record with sandboxing, cost, and abuse controls. | None | [evaluation-runner.md](../architecture/evaluation-runner.md) |
| Skill zip download policy | Whether members without an agent should download skills, and whether to limit downloads per link. Downloads are already rate limited per client address. | None | [ADR 0023](../decisions/0023-agent-course-delivery.md) |
| Short membership lapses | A lapse that removes the membership (for example a failed renewal fixed the same day) ends delegations; whether a grace period should keep them is undecided. | None | [ADR 0022](../decisions/0022-delegated-entitlements.md) |
| Archives and agent grants | The archive carries agent material and course agent settings, not delegations or results, which are personal grants. | None | [archive-format.md](../architecture/archive-format.md) |

## Portability and importers

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Circle column aliases | The importer reads the column names documented on 2026-10-18; renamed columns are reported as unknown. Needs real exports from a few Circle communities. | Real Circle exports | [circle.md](../operations/importers/circle.md) |
| Courses from other platforms | Skool and Circle exports contain no course content. A Markdown course importer is possible. | None | [skool.md](../operations/importers/skool.md), [circle.md](../operations/importers/circle.md) |
| Media in imports | Images and attachments stay on the source platform's URLs. A fetch job with an allowlist, size and type checks, and the storage limit is needed. | None | [archive-format.md](../architecture/archive-format.md) section 5 |
| A cross-community policy for the expiry sweep so it uses migration_jobs_expiry_idx | The daily `migration.files-expiry` job walks every community, because the row level security policy on `migration_jobs` needs a community scope. A policy setting that allows a cross-community read for this job would let one query use the index (review of r39, 2026-10-22). | None | `packages/migration/src/lifecycle.ts` |
| Invite tokens stored in plain text | `invite_links.token` holds the token itself, so a database read leaks working links, including the single use links imports send. Hashing at rest needs a migration (review of r47). | Migration owner | `packages/db/src/schema/communities.ts`, `packages/migration/src/member-emails.ts` |
| Resendable people load the whole id map | The People page loads every import job's id map to find who can get "Resend email". Large imports need a paginated or indexed lookup (review of r47). | None | `packages/migration/src/member-emails.ts` (`resendableUserIds`) |
| Claim a placeholder's history on accepting the invitation | On Cloud an import keeps each person as a placeholder whose membership only holds history and sends an invite link. Accepting it adds a membership for the real account and leaves posts, comments, and points on the placeholder, whose membership stays `removed`. The joining service needs to move the placeholder's rows to the real account in one transaction ([0043](../decisions/0043-import-invitations-and-emails.md)). | None | `packages/communities` (joining), `packages/migration/src/member-emails.ts` |
| A dedicated invited membership status for placeholders | Imported placeholders reuse the `removed` membership status, so the member export and the People status filter cannot tell a placeholder waiting for its invitation from a member who was removed. A new `invited` status needs a migration and changes to the export, the filters, and the joining service. | Migration owner | `packages/migration/src/import/restore-people.ts`, [0043](../decisions/0043-import-invitations-and-emails.md) |
| Reset password page ignores `next` | The direct choose a password link from an import carries `next=/c/{slug}`, but the page sends people to Sign in after they choose a password, so they do not land in the community ([0043](../decisions/0043-import-invitations-and-emails.md)). | None | `apps/web/app/(auth)/reset-password` |
| Erasure and retention policies on `subscriber_moves` | An `app.account_purge` row level security policy keyed by email would let account erasure reach rows in communities the person never joined, and a cross-community policy would let the retention sweep use one query. Both need a migration (relay of r43; migration owner needed). | Migration owner | [0042](../decisions/0042-moving-paying-members.md), migration of `subscriber_moves` |
| Imported accounts are unverified | Imported people sign in through "Forgot password", and linked subscriptions wait for email confirmation. Whether a same software archive may carry a verified flag or password hashes is undecided. | None | [archive-format.md](../architecture/archive-format.md), [offboarding.md](../operations/offboarding.md) |
| Agents in archives | Agent identities, post drafts, approval requests, and webhook endpoints are not exported; tokens and secrets never should be. | None | [archive-format.md](../architecture/archive-format.md) |

## Product

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Purchase confirmation after leaving | The "Welcome to {community}" message shows only on the checkout return URL (decision E-02). A one time confirmation on the feed or a welcome notification would cover members who close the tab. | None | `apps/web/app/c/[slug]/membership/page.tsx` |
| Dead invite link page | The join page shows an error instead of sending the person to the About page (decision E-07). Journey 3 documents the behavior as built; whether a dead link should open About instead is undecided. | None | [user-journeys.md](user-journeys.md) |
| Imported reviews show Former member | Reviewer status is computed from Payments on read. An archive import brings subscriptions in as comped access, so imported reviews say "Former member" until the creator links the subscriptions again with Bring your existing subscribers. A status hint stored with the review, or a note in the import summary, would close it. | None | [archive-format.md](../architecture/archive-format.md), `packages/reviews` |
| Edit one date of a repeating event | Edit always changes the whole series; only Cancel works on one date. "This date only" edits with time and location overrides are not built now (founder, 2026-10-22). | None | [mvp-scope.md](mvp-scope.md), `apps/web/lib/calendar/views.ts` |
| Event capacity and waitlist | Events have no RSVP limit and no waitlist. Not built now (founder, 2026-10-22). | None | `packages/calendar` |
| Post a new event in the feed | The "Event created." toast offers "Copy link" only. "Post about it in the feed" needs a composer that opens with text filled in, which the feed does not have. | None | `apps/web/components/feed` |
| Own setting for RSVP confirmations | The RSVP confirmation and the "Not going" email follow the Event reminders email setting. A separate preference needs a new notification type and a migration (review of r35, 2026-10-22). | None | `packages/notifications` |
| Reminder notice after a released claim | When a reminder send fails, the claim is released and a later run inserts the in-app reminder again; the unique index only blocks a second unread row, so a member who already read the first one sees it twice (review of r35, 2026-10-22). | None | `packages/calendar` |
| Lesson file order and display names | Lesson files cannot be reordered or renamed for members, and uploads stay in storage when the creator cancels before Save. Order and display names need a schema change and over a day of work. | None | `packages/ui/src/classroom/lesson-form.tsx` |
| Video thumbnail and title in the lesson editor | The editor shows the provider's click to load embed under the video link. A thumbnail and title need an oEmbed fetch to the provider, an external request from the server. | None | `packages/ui/src/classroom/lesson-form.tsx` |
| Auto approve complete join requests | Approving every request whose required questions are all answered needs a new community setting and a migration. Bulk approve covers launch days today. | None | `packages/communities/src/manage/joining.ts` |
| Member notes and role history in Manage | The member drawer shows answers, access, activity, and actions. Private staff notes need a new table, and role history needs the audit log (owner and admins only) joined per person. | None | `apps/web/components/manage/member-drawer.tsx` |
| Drag a lesson to another module | Each module has its own drag list, so a lesson cannot be dragged across modules. "Move to" in the lesson row menu covers it today, for keyboard and touch too. | None | `packages/ui/src/classroom/outline-editor.tsx` |
| Level lock on inline lesson images | Images placed in a lesson body are stored under `posts/` keys and served like post images, so a member below the level who has a direct image link can still open it. The lesson text, attachments, and agent material are locked ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)). | None | `packages/courses/src/markdown.ts` |
| Member faces and a smarter member count on About | The review of 2026-10-21 asks for up to 5 member avatars next to the count once 10 or more members allow it, and an owner choice to hide a small count or show "Founding members". Both need stored choices that do not exist yet: a per member consent to show their face to visitors, and an owner setting for the count. That is a migration, which the About media unit did not own. | None | `apps/web/components/community-top/community-meta.tsx` |
| Side by side preview in the Page text editor | View About page opens the real page with the preview banner; a live preview next to the editor would need a second renderer of the About page ([0036](../decisions/0036-about-page-that-sells.md)). | None | `apps/web/components/manage/about-editor.tsx` |
| Community name and reviews switch next to the About editor | Both stay in Manage, Settings ([0036](../decisions/0036-about-page-that-sells.md) follow ups). | None | `apps/web/components/manage/reviews-form.tsx` |
| About fields in the REST API and MCP | What you get, the host credential and bio, and the Questions are written by `updateAbout` and read by `getAppearance` and `getAbout`, but no REST route or MCP tool exposes them yet ([0036](../decisions/0036-about-page-that-sells.md) follow ups, [0032](../decisions/0032-error-catalog-and-list-shape.md) catalog pattern). | None | `packages/api/src/routes/manage.ts` |
| Trial line on the About page | Plans have no trial field, so the hero cannot say "Free for 7 days". | None | `apps/web/lib/communities/about-offer.ts` |
| Video length on the gallery poster | The review asked for a "Play video · 3 min" chip; the chip says "Play video" because video lengths are not stored. Storing them needs the provider's API (YouTube Data API key) or oEmbed duration where offered. | None | `apps/web/components/about/about-gallery.tsx` |
| Resized copies of earlier uploads | Covers and gallery images uploaded before resizing existed keep one file and load full size. A one time job could create the copies and switch the stored keys. | None | `packages/storage/src/variants.ts` |

## Email

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| HTTP email provider adapter | Only SMTP is built, so provider bounce and complaint webhooks cannot come in. Provider specific adapters and their webhooks are deferred (founder, 2026-10-22). A signed generic webhook, `POST /api/webhooks/email`, takes bounces and complaints from a relay meanwhile ([0035](../decisions/0035-email-suppression-and-delivery-headers.md)). SMTP stays the self hostable default. | None | [overview.md](../architecture/overview.md) section 9, `packages/email/src/env.ts` |
| Send the welcome when a member confirms their email later | The welcome job skips members whose email is unconfirmed or who are not entitled when it runs, and nothing schedules it again, so they never get a welcome. | None | `packages/notifications/src/welcome/job.ts` |
| Weekly digest switch per community | Members turn the weekly digest on or off for all their communities in Account, Notifications. Creators have no switch to stop it for their community (product owner, 2026-10-22). | None | `packages/notifications/src/weekly-digest/job.ts` |
| Quiet hours for non urgent emails | Comment and join request emails go out at any hour in the reader's time zone. Optional quiet hours need scheduling changes over a day of work. | None | `packages/notifications/src/email/plan.ts` |
| Notification emails are delivered at most once | The claim marks each notification email as sent before the email goes out, so a worker crash between the two loses that email. Add a claimed state with a sweep that retries claims older than a few minutes. | None | `packages/notifications/src/email/claims.ts` |

## Engineering

| Item | Why it is open | Human gate | Where |
|---|---|---|---|
| Write input schemas once | The same input is defined in the service, the API, and the web action. Deriving them from one schema is a cross package refactor over a day with no user impact. | None | `packages/api/src/routes/payments-schemas.ts`, `apps/web/lib/payments/schemas.ts` |
| Retire the hand written fake repositories | Posts and communities tests use fakes that do not model row level security. Rewriting those tests against Postgres is several days of work. | None | `packages/posts/src/test/fake-repository.ts`, `packages/communities/src/test/fake-repository.ts` |
| RLS policies call `current_setting` per row | Wrapping each call in a subselect lets Postgres evaluate it once per query. Rewriting about 19 policies is a large migration for a small gain. | None | `packages/db/src/schema/communities.ts` |
| Validate `notifications_post_subject` | Migration 0036 adds the widened check `NOT VALID` so deploy takes no long lock. Every old row already passed the narrower check, so validating it later only marks it validated. | None | [data-model.md](../architecture/data-model.md) section 11 |
| Grouped counts across the 0036 deploy | A grouped notice opened before migration 0036 has no `notification_group_sources` rows, so the first event after deploy from someone it already counted can count that person a second time. | None | [data-model.md](../architecture/data-model.md) section 11 |
| `braces` advisory in the lint toolchain | GHSA-vfj7-8cjw-p6xm affects `braces@3.0.3`, pulled in by `@next/eslint-plugin-next`. No fixed release exists, and it runs only in development on our own globs. Add a `pnpm.overrides` entry once a release exists. | None | `packages/config/package.json` |

## Decisions and open questions

- **Open question:** every row above. Rows with a human gate wait on that person; the rest are engineering or product work without a founder decision.
