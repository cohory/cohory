# Payment migration

Status: Draft, 2026-10-22

How a creator moves paying members to cohory without asking them to pay twice. This page covers REQ-SUB-007 and REQ-MIG-005. There are three options. Which one applies depends on where the members' subscriptions live today and on the edition ([0042](../decisions/0042-moving-paying-members.md)).

| Option | When it applies | What members do | Built |
|---|---|---|---|
| A. Link existing subscriptions | Community Edition only: the subscriptions live in a Stripe account you own, and you connect that account with its keys | Nothing, or sign up with the same email | Yes |
| B. Stripe account to account copy | Community Edition: the subscriptions live in another Stripe account (for example an old business account) | Nothing after Stripe copies the data, then Option A | Guide only |
| C. Subscribe again with free time | Cloud, always. Anywhere the old platform keeps the payment details (for example Skool or Circle), or another platform created the subscriptions | Start a new subscription in cohory, free until their old renewal date | Yes |

**Cloud does not offer Option A.** Connecting Stripe on Cloud always creates a new connected account, and a new account holds none of your existing subscriptions. The Payments service refuses to list or link subscriptions on Cloud, and "Bring your existing subscribers" shows only Option C there.

## Option A: link existing subscriptions

Community Edition only. Where: Manage, Migration, "Bring your existing subscribers" (route `/c/{slug}/manage/migration/subscribers`). Manage, Payments has a card that opens the same page. Owners and admins can use it (`payment.link_subscriptions`). The REST API offers the same steps under `/api/v1/communities/{communityId}/payments/subscribers`: `GET /subscribers` (operation `discoverSubscribers`) lists one page with the proposed actions, `POST /subscribers/link` (`linkSubscribers`) links the chosen rows, and `GET /subscribers/links` (`listSubscriptionLinks`) returns the ledger; the API does not send the "Your membership has moved" email, so API callers notify invited people themselves.

Steps:

1. Connect the Stripe account that holds the subscriptions on Manage, Payments with its own secret key.
2. Open "Bring your existing subscribers". cohory lists the active, trial, and past due subscriptions on that account, 50 per page, with the customer email, the price, the billing period, the status, and the renewal date.
3. Each row shows a proposed action:
   - **Link to member** when the email belongs to an active member whose email is confirmed.
   - **Link and add member** when the email belongs to a confirmed account that is not an active member.
   - **Invite by email** when nobody has that email, or the account with it has not confirmed it yet.
   - **Skip** is always possible.
4. Choose whether each subscription counts as a monthly or a yearly membership. cohory suggests one from the Stripe price (the plan's own price, or a one month or one year interval). Other periods, such as weekly or every 3 months, need your choice.
5. Confirm. cohory fetches every subscription from Stripe again, matches it again, and then links it. Linked members get access at once. Invited people get an email ("Your membership has moved") and get access when they sign up with that email, confirm it, and open the membership page.

What linking writes: a `payment_customers` row that binds the Stripe customer to the member, a `subscriptions` mirror row with `origin = linked_import` and the Stripe price id, the membership, one `subscription_links` row per Stripe subscription (the migration ledger), and an audit entry (`subscription.linked`, `subscription.invited`, `subscription.claimed`). Linking the same subscription twice does nothing the second time.

After linking, the usual webhooks keep the mirror in sync: renewals (`invoice.paid`), failed payments, changes, and cancellations made in the Stripe Dashboard all reach cohory. Members manage billing and cancel from their membership page, which opens the Stripe customer portal.

Limits:

- No card data moves. The member keeps paying on the same Stripe subscription, at the same price and renewal date.
- Only subscriptions that you created on your own account can be linked. Subscriptions that another Connect platform created (Stripe sets their `application`) are shown as "Created by another platform" and cannot be linked. Use Option C for them.
- Matching uses the email on the Stripe customer, case insensitive. A customer without an email, a banned person, or a Stripe customer already bound to another member can only be skipped.
- An account must have a confirmed email to be linked. This stops someone from registering a subscriber's email to take their access.
- cohory never changes the price of a linked subscription. The plan mapping only decides which membership it counts as.
- There is no platform fee on the Community Edition, so linked subscriptions carry none.
- The page reads one page of Stripe subscriptions at a time and links up to 100 rows per confirmation.

## Option B: Stripe account to account copy

When the subscriptions live in a different Stripe account than the one you connect, Stripe can copy customers and payment methods between accounts on request. This is a Stripe process, not a cohory feature.

1. Ask Stripe support to copy the customers and payment data from the old account to the account you will connect. Stripe copies customers and saved payment methods, not subscriptions (**Unverified**: confirm the current scope with Stripe before you plan around it).
2. Recreate the subscriptions on the new account (in the Stripe Dashboard or with the API), using the copied payment methods and a trial or billing anchor that matches each old renewal date.
3. Cancel the subscriptions on the old account.
4. Link the new subscriptions with Option A.

Limits: Stripe decides whether and when it copies data. Subscription history stays on the old account. cohory does not automate any of these steps.

## Option C: subscribe again with free time

When cohory cannot reach the payment details (Cloud, the old platform keeps them, or another platform created the subscriptions), members start a new subscription in cohory. They get free time until their old renewal date, so nobody pays twice.

Where: the Paying members to move card on "Bring your existing subscribers" (Manage, Migration, or the card on Manage, Payments; "Move paying members" on Cloud). Owners and admins can use it.

1. Build the list.
   - After a Skool, Circle, or archive import, "Add them to the list" adds the people the import marked as paying: Skool's Price and Tier columns, a Circle paywall column, or the active subscriptions in an archive. Archive members get their paid through date as the free until date, or a week after the import when that date has already passed.
   - Or paste email addresses, one per line, each with the old renewal date (`ada@example.com 2026-11-18`), or set one Free until date for the lines without one. Adding a person again changes their date while they have not moved. A paste holds up to 1,000 people, and the list up to 5,000 per community. Rows without a date show "No renewal date".
2. Connect Stripe and put a price on sale, if you have not yet.
3. Press "Email everyone not moved yet". Each person gets "Keep your membership": they won't be charged until their date, they should cancel the old subscription now, and the button opens the membership page. A person gets this email at most once a week, and no longer once their free time ended more than a week ago (or, without a date, 30 days after they were added). Only an owner or admin pressing the button sends it; two presses at the same time never email anyone twice.
4. The member signs in or signs up with that email and subscribes from the membership page. Checkout starts with a free period that ends on their date. Stripe needs at least 48 hours of free time; when the date is closer, the subscription starts at once. A member who already has free access in the community (for example from an import) can subscribe too.
5. The list shows "Moved. Cancel their old subscription" as soon as cohory records a new subscription for that person, even one still waiting for payment. Cancel the old one if the member has not.

When a member has a linked subscription that is set to end (for example because you canceled it at the period end to move them to the cohory plan), their membership page shows "Your current subscription ends on {date}" with "Subscribe again", with the same free period.

Archive imports give each paying member free access until the date they paid for (at least a week after the import), then the access ends. Add them to the list so they subscribe before then.

On the Community Edition, adding a person with a date to the list also ends their free access at that date when they are a plain member of a paid community (for example after a Skool or Circle import) with no subscription and no free access grant yet. cohory records it as free access that ends on the date (at least a week from now), so it shows under Free access and the hourly expiry removes the membership if they have not subscribed. Pasting them again with another date moves that end, but never to less than a week from now. People without a date keep their access. Cloud leaves free memberships open.

Retention: cohory removes a row 90 days after the free time ends or the person moved, and a row without a date 120 days after it was added (the daily `payments.moves-retention` job). When a member deletes their account, erasure removes their rows in every community they belong to and replaces the email on their subscription links with an `@erased.invalid` address. A row for an address that never joined stays until the retention job removes it.

Limits: members must act. Some will not come back. The old platform's own fees and rules apply until it is canceled there. Free time can last up to two years. When the server requires confirmed emails, a member gets the free time only after confirming the address. Without that requirement (no SMTP server), anyone who signs up with an address on the list gets its free time, so on such a server add only addresses you trust and keep the dates short ([self-hosting](../self-hosting.md)).

## Bring your own payment provider

Since 0.5.0, the platform fee for payments through a provider other than Stripe (REQ-PAY-008) is billed through the fee ledger and a periodic invoice ([platform-billing.md](platform-billing.md), [payments.md](../architecture/payments.md) section 9). Linking existing subscriptions on this page works for Stripe own keys only.

## Related

- [payments.md](../architecture/payments.md) section 10 (ownership and portability) and section 13.9 (linking as built)
- [user journey 13](../product/user-journeys.md#13-creator-brings-existing-stripe-subscribers)
- [testing.md](../open-source/testing.md#testing-payments-against-stripe-test-mode) for the sandbox check
