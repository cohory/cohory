# Voice and tone

How Cohory sounds in marketing, product UI, errors, billing, docs, and on GitHub, with concrete rules and examples.

Related: [brand strategy](./brand-strategy.md), [visual identity](./visual-identity.md), [information architecture](../product/information-architecture.md), [agent integrations](../architecture/agent-integrations.md).

## Voice principles

Voice stays the same everywhere. Tone shifts with context. **Recommendation:** five principles.

1. **Plain over technical.** Write for a yoga teacher running a paid group, not for the engineer who built the feature. Technical terms appear only in developer docs and API references.
2. **Exact about money and data.** Numbers, fees, dates, and limits are stated precisely. "2% of each successful payment", never "a small fee".
3. **Calm, not cheerful.** No exclamation marks, no hype, no pressure. Confidence comes from clarity.
4. **Honest about limits.** If something is not built, not supported by a provider, or not reversible, say so before the user commits.
5. **Short, then useful.** Lead with the answer or the action. Add the detail a person needs to decide, then stop.

## Tone by context

| Context | Tone | Example |
| --- | --- | --- |
| Marketing | Warm, direct, confident. Concrete claims backed by pricing and docs | "Free to self-host. 2% on the cloud when you earn." |
| In-product UI | Quiet and functional. Labels name the thing, buttons name the action | "New post", "Continue lesson", "Join event" |
| Errors | Calm, specific, blame free. Say what happened and what to do next | "We couldn't upload the video. The file is over 2 GB. Try a smaller file." |
| Empty states | Encouraging but brief. One sentence of context, one primary action | "No events yet. Schedule the first one for your members." |
| Billing and money | Precise and neutral. Show amounts, fees, and dates together | "You'll be charged $29.00 on 3 November 2026." |
| Security and legal | Serious and clear. No humor. State consequences | "Deleting this community removes all posts, courses, and members. This can't be undone." |
| Docs | Instructive, second person, imperative steps, tested commands | "Run `docker compose up -d`, then open http://localhost:3000." |
| Community and GitHub | Respectful, collaborative, factual. Thank people, explain decisions | "Thanks for the report. We reproduced it on 0.3.1 and the fix is in #412." |

## Plain-language rules

**Confirmed** (founder):

| Before | After |
| --- | --- |
| Stripe Connect OAuth Configuration | Connect your Stripe account |
| Application Fee Percentage | Platform fee: 2% |
| Subscription Migration | Bring your existing subscribers |

**Recommendation** (additional):

| Before | After |
| --- | --- |
| Tenant settings | Community settings |
| Entitlement revoked | This member no longer has access to Premium |
| Webhook delivery failure | We couldn't confirm a payment with Stripe. We'll retry automatically. |
| RBAC role assignment | Change role |
| Invalid input | Enter an email address, like name@example.com |
| Operation failed | We couldn't save your changes. Check your connection and try again. |
| Dunning in progress | Payment failed. We'll retry on 5 November. |
| Gamification configuration | Points and levels |
| Asset upload exceeds max payload | This image is larger than 10 MB. Choose a smaller image. |
| Membership tier SKU | Membership plan |
| Are you sure? | Remove Alex from the community? They'll lose access right away. |
| Disconnect connected account (destructive) | Disconnect Stripe. New payments will stop. Existing subscriptions stay in your Stripe account. |
| Submit | Publish post |
| Data export job queued | We're preparing your export. We'll email you when it's ready. |

## UI copy conventions

- **Product name:** write "Cohory" with a capital C in UI copy, emails, page titles, and prose, including mid sentence ("Sign in to Cohory"). Keep "Cohory" lowercase only where it is a technical string: package names, URLs, CLI commands, environment variables, code identifiers, token prefixes, and cookie names.
- **Sentence case** for everything: buttons, titles, tabs, menu items, table headers. "Create community", not "Create Community". Product names and proper nouns keep their case (Stripe, Classroom as a tab name).
- **Buttons start with a verb** and name the outcome: "Publish post", "Save changes", "Connect Stripe", "Remove member". Avoid "OK", "Submit", "Yes". In confirmation dialogs the confirm button repeats the action ("Delete course"), and cancel is always "Cancel".
- **Loading labels end with an ellipsis character** ("…", not three dots) and keep the object of the idle label: "Save bio" becomes "Saving bio…", "Delete endpoint" becomes "Deleting endpoint…". Status text that is not an action in progress (a "Canceling" badge, "Recording link saved.") keeps its normal punctuation.
- **Name the object in save and delete buttons** whenever more than one thing on the page could be saved or deleted: "Save settings", "Save appearance", "Delete scheduled post", not "Save" or "Delete".
- **No exclamation marks** in product UI, emails, or errors.
- **One primary action per screen.** Copy should not compete with it. Secondary actions are links or quiet buttons.
- **Numbers:** numerals for all quantities ("3 members", "1 lesson left"). Thousands separators use the app locale, en-GB ("1,240"). Use compact forms only for counts in tight spaces ("1.2k"), never for money.
- **Currency:** always show the currency, two decimals for amounts, and the ISO code when currencies could be ambiguous: "$29.00", "€29.00", "29.00 USD" in exports. Fee percentages are shown exactly as configured ("2%"). Never round fees in UI.
- **Dates:** relative for recent activity ("5 min ago", "Yesterday"), absolute for anything about money, access, or events ("3 November 2026, 18:00 CET"). Event and scheduled post times always show the time zone. Dates use the app locale, en-GB, so the day comes first ("25 Oct 2026", "Sunday, 25 October 2026 at 09:00 (Europe/Istanbul)"). The time zone is the viewer's (the `tz` cookie, UTC until the browser sets it), or UTC with "(UTC)" shown for logs and expiry times.
- **Pluralization:** use ICU message format so every count has a correct form ("1 member", "2 members", "No members yet"). Never write "member(s)".
- **Names:** address people by display name. Use "you" for the reader. Use "we" for Cohory only when the system did something ("We sent a receipt").
- **Truncation:** truncate with an ellipsis and show the full text on focus or hover. Never truncate amounts, dates, or names in confirmations.

## Microcopy patterns

**Recommendation:** reusable templates so screens stay consistent.

### Error messages

Structure: what happened, why (if known), what to do. Never show stack traces, internal IDs, or provider error codes to creators or members. Log them, and offer "Copy error details" for support.

| Situation | Copy |
| --- | --- |
| Network failure | We couldn't reach the server. Check your connection and try again. |
| Permission denied | Only creators can edit courses. Ask the creator for access. |
| Payment declined | Your card was declined. Try another card or contact your bank. |
| Stripe not connected | Connect your Stripe account before you add a paid plan. |
| Validation | Give your community a name. It can be changed later. |
| Rate limited | You're posting quickly. Wait a minute and try again. |

### Empty states

Structure: one sentence on what will appear here, one primary action (only for people who can act). Members without permission see the sentence only.

| Screen | Creator | Member |
| --- | --- | --- |
| Community feed | Write the first post to welcome your members. [New post] | No posts yet. Check back soon. |
| Classroom | Create your first course. [New course] | No courses yet. |
| Calendar | Schedule your first event. [New event] | No upcoming events. |
| Leaderboard | No points yet. (The line above the board says how points are earned.) | No points yet. |

### Confirmations

Title is a question naming the object. Body states the consequence. Confirm button repeats the verb.

> **Delete "Week 1: Foundations"?**
> The module and its 4 lessons will be removed for all members. Member progress for these lessons is also deleted.
> [Cancel] [Delete module]

### Success feedback

Use a short toast in the past tense, no exclamation mark, with an undo where possible: "Post published. [View]", "Member removed. [Undo]". Do not show toasts for actions whose result is already visible on screen.

### Billing copy

Always show amount, currency, interval, and next date together, and show the fee split where the creator sees payouts.

> Premium membership. $29.00 per month. Next payment 3 November 2026.

> Payment of $29.00. Processing fee $1.14 (charged by Stripe). Platform fee $0.58 (2%). You receive $27.28.

**Open question:** the fee base and rounding rule (for example whether the 2% applies before or after tax and refunds) must be defined before production. The example above assumes the fee applies to the gross amount, rounded half up to the cent. See [payments architecture](../architecture/payments.md).

### Notifications and email

Subject lines name the community and the event: "[Design Club] Alex replied to your post". Body is one or two sentences and one link. Every email states why the person received it and links to notification settings.

## Writing for agents

**Recommendation:** API and MCP text is read by programs and language models as well as people. It must be unambiguous. (MCP and agent identities are planned post-MVP; the REST API rules apply from MVP.)

- **Error messages** have a stable machine `code`, a human `message`, and structured `details`. The message states the cause and the fix in one sentence. Example: `code: "membership_plan_archived"`, `message: "Membership plan 'Premium' is archived and cannot accept new members. Use an active plan or unarchive it."`.
- **Name things once.** Use the terminology from the conventions (community, member, membership, subscription, entitlement, platform fee) identically in UI, API fields, and docs. Never alias "member" as "user" or "customer" in one place.
- **Operation descriptions** say what the operation does, what it changes, who may call it, and whether it is reversible. "Removes a member from the community. Revokes their entitlements immediately and cancels their subscription without a refund. Requires the `members:write` scope."
- **State units and formats** in every field description: money in minor units with a currency code, timestamps in ISO 8601 UTC, percentages as basis points.
- **Never rely on visual context.** No "click the blue button", no "see above".
- **Flag consequences.** Financial or destructive operations say so in the first sentence and state whether human approval is required.

## Words to use and avoid

| Use | Avoid | Why |
| --- | --- | --- |
| community | tenant, workspace, group (in UI) | One word for the main object |
| member | user, customer, subscriber (in UI) | Members belong to communities. "Subscriber" only when talking about payments |
| creator | admin, owner, host | Consistent role name |
| membership plan | tier, SKU, product | Plain and specific |
| platform fee | commission, take rate, application fee | Matches pricing copy |
| processing fee | Stripe fee, transaction cost | Provider neutral |
| export | backup, dump | Export is the user facing feature |
| connect / disconnect | integrate, link up, OAuth | Plain verbs |
| remove member | ban, kick (unless moderation) | Calm by default |
| course, module, lesson | program, chapter, unit | Matches Classroom structure |
| planned | coming soon, launching shortly | Honest about status without dates |
| simple, clear | seamless, effortless, revolutionary, magic | Concrete words over hype |
| you own | lock in, trapped (about competitors) | Describe our behavior, not others' |

## Decisions and open questions

- **Confirmed:** the three founder plain-language rewrites.
- **Recommendation:** voice principles, tone table, UI copy conventions, and word list above.
- **Recommendation:** structured API errors with stable codes; money in minor units, percentages in basis points.
- **Assumption:** the product ships English first, with ICU message format from day one so translation does not need a rewrite.
- **Recommendation** (2026-10-22): one fixed app locale, en-GB, for every date and number, through `formatDate`, `formatDateTime`, `formatDateTimeWithZone` (`@cohory/ui/lib/format-date`) and `formatCount` (`@cohory/ui/lib/format-number`). A fixed locale renders the same text on the server and in the browser, so it cannot break hydration. The lint rule `cohory/fixed-locale` rejects locale less `toLocale*String` and `Intl` formatters in client components.
- **Open question:** which locales are supported at launch once the UI is translated.
