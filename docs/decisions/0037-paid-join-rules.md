# 0037. Paid join rules: payment is the approval, invite only gates checkout, and draft prices

A community that sells memberships uses payment as its approval step. Invite only keeps checkout behind an invite link, join questions are asked before checkout, and an owner can save a draft price before Stripe is ready.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: product owner under the founder's mandate (founder decision, 2026-10-22), coordinator for the details
- Related: [0026](0026-community-page-for-non-members.md), [0036](0036-about-page-that-sells.md), [../architecture/payments.md](../architecture/payments.md) section 13.4, [../product/decisions-log.md](../product/decisions-log.md) row P3

## Context

The manage review found that join modes and paid joins ignored each other. An owner could pick Approval for a paid community, and then nobody could tell whether a buyer still had to be approved after paying. Invite only hid the Join button but the Membership page still sold to anyone with the URL. Join questions were only asked with Request to join, so a paid community never saw any answers. Owners could not set a price until Stripe onboarding was finished, so the pricing card was empty while they waited.

## Decision

1. **Payment is the approval.** While a plan is on sale, Approval cannot be selected in Manage, Settings, Joining. The option is disabled with the reason "Paid communities: payment is the approval. Stop selling memberships to use Approval." The server enforces the same rule: putting a plan on sale turns join mode `approval` into `open` in the statement that sets the community currency, and `updateSettings` saves `approval` as `open` while the community has a currency. Stopping sales leaves the join mode as it is. For the same reason the invite link switch "People who use this link need approval" is disabled with a one line reason while a plan is on sale, and existing links do not show "needs approval".
2. **Invite only gates checkout.** In a paid community with join mode `invite`, checkout raises `invite_required` (HTTP 403) unless the person has a pending or active membership or an earlier subscription in the community, so a member whose card failed can pay again without a new invite. Banned people and banned emails are still refused. The About and Membership pages show "Invite only" and no price button. Redeeming an invite link holds a pending membership (a removed membership moves back to pending; a banned person or email gets nothing), counts one use of the link, and sends the person to the Membership page, where checkout is open to them. The invite does not waive the price (F-12 stands).
3. **Questions before checkout.** The Membership page asks the community's join questions before the person pays. People who were members or paid before (any membership other than an invite hold, or an earlier subscription) are not asked again, so "Subscribe again" works without answers. Starting checkout with no answers deletes earlier pending answers. Checkout takes the answers, refuses an empty required answer, and keeps them with the question text in `pending_join_answers`. When the subscription activates the membership, they move to `memberships.join_answers` as `{ question, answer }` pairs, which the existing column now accepts next to a plain string list. The member drawer in Manage, People shows them when the person has no join request.
4. **Draft prices.** When no plan is on sale and the connection cannot take payments yet, saving the pricing form stores a draft: a `membership_plans` row with no connection. A draft makes no Stripe call, sets no community currency, and is never sold or used by the access rule. Owners see it in the form with "Save draft" and "Discard draft". Saving on a ready connection puts it on sale through the normal path and archives the draft. Two first saves at the same moment answer `plan_conflict` (HTTP 409, "The pricing changed while it was being saved. Reload the page and try again.") instead of an internal error. Revenue metrics ignore drafts when they choose the currency. Nothing goes on sale without the owner pressing "Put on sale".

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Approval after payment | Owners keep a screening step | A paying member waits on a person, and a declined buyer needs a refund flow | The founder chose payment as the approval |
| Store answers in Stripe Checkout custom fields | No new storage | Limited to Stripe, at most three short text fields, answers live in the creator's account only | Answers belong with the membership, for every provider |
| Count the invite use at checkout completion | A link with a use limit is only used up by buyers | A second table or column to hold the invite through checkout, and a race on the last use | Count at redeem; abandoned checkouts are a follow up |
| A `draft` status column on `membership_plans` | Explicit | Needs a migration and every reader to filter it | A null `connection_id` already means no account can sell it |
| Publish a draft automatically when Stripe becomes ready | One step fewer | The owner may not expect sales to start | The owner presses "Put on sale" |

## Consequences

- Positive: join controls behave the same on the About page, the Membership page, and checkout; owners see who paid and what they answered; the pricing card is useful while onboarding.
- Negative: an abandoned checkout after an invite still uses one invite, and the pending hold never expires. The paid members table shows the plan price, not the amount each member was last charged.
- Follow ups: hold expiry and giving the invite use back after an abandoned checkout need a migration and are built separately ([backlog](../product/backlog.md)).

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Payment is the approval, approval disabled and coerced while on sale, questions before checkout with answers stored on the membership (founder decision, 2026-10-22). |
| Recommendation | Invite use counted at redeem, drafts as plans without a connection, the 1000 character limit on answers, and leaving the join mode unchanged when sales stop. |
