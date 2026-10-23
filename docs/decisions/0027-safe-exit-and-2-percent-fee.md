# 0027. Safe exit for paid communities, a 2% Cloud fee, and Polar off by default

Every way an owner can leave (archive, delete, disconnect, transfer, account deletion) is made safe for paying members and honest for the creator. The Cloud platform fee becomes 2% for new subscriptions, and Polar is no longer offered unless an operator turns it on.

Status: Accepted, 2026-10-20

- ADR status: Accepted
- Date: 2026-10-20
- Deciders: founder
- Supersedes: the fee rate in [0007](0007-stripe-connect-direct-charges.md) (2%). The rest of 0007 stands.
- Related: [0007](0007-stripe-connect-direct-charges.md), [0008](0008-platform-fee-ledger.md), [0009](0009-license.md), [../architecture/payments.md](../architecture/payments.md), [../foundation/business-model.md](../foundation/business-model.md), [../operations/payment-providers.md](../operations/payment-providers.md)

## Context

Creators on Cohory Cloud charge members through Stripe Connect direct charges on the creator's own Stripe account ([0007](0007-stripe-connect-direct-charges.md)). Research on 2026-10-20 (Stripe documentation and Ghost, Circle, Mighty Networks, Substack, Skool, Kajabi, and Patreon) confirmed this model: it is Stripe's recommended charge type for platforms whose creators sell to their own audience, it is the only model under which creators can leave with their paying members, and it keeps Cohory out of loss liability. The founder kept it.

What happened when an owner left was not safe. Archive, delete, disconnect, ownership transfer, and owner account deletion all left member subscriptions billing, sometimes with no way for members to cancel from Cohory and no notice to them. Disconnect marked the connection disconnected first and removed the application fee in a job afterwards. Members charged after a community is gone are the most common complaint about this model on comparable platforms.

The founder also confirmed the Cloud fee at 2%, and switched Polar off because Polar's acceptable use policy prohibits marketplaces and "community access" (https://polar.sh/docs/merchant-of-record/acceptable-use).

## Decision

### Platform fee

- The Cloud platform fee default is 200 basis points (`PLATFORM_FEE_BPS=200`). The fee module (`packages/payments/src/fee.ts`) stays the only place it is computed, and the rate comes from its config.
- Existing subscriptions keep the rate they were created with. There is no backfill: the `application_fee_percent` stored on each Stripe subscription stays, and the fee ledger records each `fee_collected` entry at the rate stored on the mirrored subscription the payment belongs to. New checkouts and new linked subscriptions where the creator opted into a fee use 2%.
- The change takes effect immediately because there are no live Cloud creators. The 60 day notice rule in [business-model.md](../foundation/business-model.md) stays for future changes.
- The Community Edition stays at 0%. It uses the creator's own Stripe keys, Cohory cannot collect a fee there, and [0009](0009-license.md) and the principles promise it is never charged.

### Polar

- `COHORY_ENABLE_POLAR`, read through `parsePaymentsEnv` and off by default on both editions, gates the provider selector, the capability records, new Polar connections (`provider_disabled`), and new checkouts on an existing Polar connection.
- Existing Polar connections keep their webhook route and sync, so no operator's access sync freezes. The owner is told that Polar is no longer offered and to move to Stripe.
- The Polar code is not removed. Removal touches the provider abstraction, the fee accrual ledger ([0008](0008-platform-fee-ledger.md)), the fake Polar server, and the forward only enum value, and is a later decision in the backlog.

### Exit rules

1. **Delete (only after archive).** Before deleting, Cohory cancels every active, trialing, past due, or unpaid subscription it mirrors for the community immediately, without proration or refunds, with one idempotency key per subscription, and verifies by re-fetching. If a cancel still fails after retries, the community stays archived and nothing is deleted; the owner sees how many subscriptions could not be cancelled. When the connection has no API access any more, deletion needs the owner's confirmation that they cancelled the subscriptions in their Stripe Dashboard, with the last known count.
2. **Archive.** Archiving blocks new checkouts and plan changes. With paying members, the owner chooses "Stop at period end" (default, every subscription set to cancel at period end) or "Keep billing". Restoring does not undo the choice by itself.
3. **Disconnect.** The order is fixed: remove the application fee from every subscription and verify, apply the owner's choice ("Take my members with me" by default, or "Wind down" to cancel at period end), and only then close the connection. After disconnect, paid access ends at each subscription's stored period end. When Stripe reports `account.application.deauthorized`, Cohory applies the same rules with "Take my members with me" implied and tells the owner how to clear the fee in the Stripe Dashboard.
4. **Transfer ownership.** New checkouts pause until the new owner keeps the existing Stripe account or connects their own. Existing subscribers are never moved between accounts.
5. **Owner account deletion.** Blocked while the person owns a community that still has active subscriptions or an open connection.
6. **Account billing page.** `/account/billing` lists every paid membership across communities, with "Manage billing" while the connection is open and "Billed directly by {community}" when it is not.

### Calls made after the builder check

1. Exit actions touch only subscriptions Cohory mirrors for the community. Linked imports are included by default and listed separately, with an option to leave them running. Each subscription is re-fetched before acting and skipped when it is no longer active.
2. One connection per community on transfer. "Keep the existing account" leaves it unchanged, fee included. "Connect my own account" runs the normal disconnect flow on the old connection first, then onboarding.
3. A disconnect that cannot finish moves the connection to a `disconnecting` state with checkouts paused and retries with backoff. After retries the owner may choose "Disconnect anyway". For any connection that is disconnecting or closed, Cohory refunds every application fee it still receives, so it never keeps a fee collected after the owner asked to leave.
4. Money records survive community deletion. Fee ledger entries, payments, and platform invoices are detached from the community cascade with a snapshot of the community name and id, and deletion is blocked while a platform invoice is unpaid.
5. `COHORY_ENABLE_POLAR` gates new Polar connections, new Polar checkouts, and the provider selector on both editions; existing Polar connections keep webhooks and sync.
6. The "Take my members with me" email always says: "Your membership is now billed directly by {community}. To change or cancel it, use the link in your Stripe receipt emails or contact {support contact}." The owner may add their Stripe customer portal login link, which must be a `https://billing.stripe.com/p/login/` link.
7. The fee change is effective immediately (see Platform fee).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Destination charges or a merchant of record | Cohory controls subscriptions on exit | Creators cannot leave with their members; Cohory carries loss liability | Breaks the ownership promise in 0007 |
| Backfill existing subscriptions to 2% | One rate everywhere | Changes what existing members pay without consent | Existing subscriptions keep their rate |
| Remove Polar now | Less code | Touches the provider abstraction, ledger, fixtures, and enum values | A flag stops new use now; removal is a later decision |
| Keep the Polar webhook route returning 404 while off | Matches the first draft of the spec | Existing self-hosted Polar connections would stop syncing access | Call 5 keeps webhooks and sync |
| Refund members automatically on archive or disconnect | Generous to members | Takes money from creators without their choice | Members keep access to the end of the paid period instead |

## Consequences

- Positive: no member is charged for a community that no longer exists, members are told what happens to their paid membership, and the platform fee is never kept after a creator leaves.
- Positive: the fee ledger stays accurate across the rate change, because each entry carries the rate of its own subscription.
- Negative: two rates coexist on Cloud until subscriptions created at 2% end.
- Negative: exits become asynchronous. One `payment_exit_runs` table and one `payments.exit-run` job drive the Stripe steps, with at most one unfinished run per community.
- Follow up: forward migration 0029 adds the exit runs table and the `disconnecting` and `deleting` states, and makes `community_id` nullable on the five financial tables that are detached on deletion. These and the exit paths ship in later Step 18 units; until they land, the exit rules above are decided but not built.

## Open questions

- EU VAT deemed supplier questions for the platform fee need a tax advisor (backlog).
- Whether "Resume renewals" after restoring an archived community ships as an action or as guidance is left to the archive unit.
