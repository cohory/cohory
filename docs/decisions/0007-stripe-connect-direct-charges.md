# 0007. Stripe Connect with direct charges and a 2% application fee

On Cloud, create checkouts and subscriptions on the creator's own connected Stripe account with direct charges and collect the 2% platform fee as an application fee.

- ADR status: Accepted (charge model and fee rate are Confirmed). The account configuration and the tax mechanism inside it are Proposed.
- Date: 2026-10-17
- Deciders: founder (charge model, fee), architecture docs wave (configuration details)
- Related: [../architecture/payments.md](../architecture/payments.md), [../foundation/business-model.md](../foundation/business-model.md)

## Context

**Confirmed:** Cloud uses Stripe Connect with direct charges on connected creator accounts and collects 2% automatically. The creator is the intended merchant of record. Subscription ownership is a major differentiator. Self-hosted pays no platform fee.

Verified on docs.stripe.com (2026-10-17): direct charges create charges on the connected account, refunds and chargebacks debit it, and direct charges are recommended for accounts with full Dashboard access. `application_fee_percent` on subscriptions accepts up to two decimals. Subscriptions keep running after disconnect and keep paying the application fee unless it is removed. Legacy Standard account types are now a deprecated path for new platforms; Accounts v2 (or v1 controller properties) offers equivalent settings.

## Decision

- Connected accounts with full Dashboard access, Stripe-collected processing fees, and Stripe loss liability (the "Standard" configuration through Accounts v2 or controller properties).
- Onboarding through Account Links. OAuth is not used.
- Checkout in subscription mode on the connected account with `subscription_data.application_fee_percent = 1`. One-time purchases (post-MVP) with `payment_intent_data.application_fee_amount`.
- When invoices carry tax, set a per-invoice `application_fee_amount` on `invoice.created` computed on the pre-tax amount, keeping the percent as fallback and refunding any excess in reconciliation.
- Refunds from Cohory use `refund_application_fee = true`. Lost disputes refund the fee on the disputed amount.
- Offboarding removes the application fee from all subscriptions before Cohory deauthorizes the account.
- Community Edition uses the creator's own Stripe keys with the same code and no application fee.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Destination charges with Express accounts | More platform control, simpler onboarding | Platform is merchant of record by default, platform pays fees and disputes, creator does not own subscriptions in a full account | Contradicts subscription ownership. |
| Custom accounts | Full white label | Platform liable for KYC and losses, creator owns nothing portable | Contradicts ownership, high liability. |
| OAuth connection of existing accounts | Familiar (Ghost, Cal.com) | Stripe no longer recommends it for new platforms | Legacy. |
| Monthly invoicing of the fee for Stripe too | One mechanism for all providers | Collection risk where Stripe can split automatically | Automatic split is safer. Ledger records both. |

## Consequences

- Positive: customers, payment methods, and subscriptions live in the creator's Stripe account and survive leaving Cohory.
- Negative: Cohory has limited visibility (objects live on connected accounts) and must query with the `Stripe-Account` header.
- Negative: creators can refund in their Dashboard without refunding our fee. Handled by webhook-driven fee refunds.
- Follow-up: test-mode verification of every item marked Unverified in [../architecture/payments.md](../architecture/payments.md) before Phase 3 ends.

## Open questions

- Accounts v2 versus v1 with controller properties.
- Whether `application_fee_percent` includes tax (Assumption: yes).
- Platform fee on pre-existing subscriptions linked in Phase 5.
