# 0039. Operator configurable legal pages, consent records, Creator Terms, and data export

Legal and trust links come from one parsed config in `packages/config`. `/terms` and `/privacy` show the operator's pages when set, Cloud drafts marked for legal review, or a neutral template. Sign up states the minimum age of 16 and records the Terms version, Cloud creators accept the Creator Terms before Stripe Connect, and anyone can download their own data.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner (founder decisions, 2026-10-22); legal wording stays a human gate
- Related: [0033](0033-platform-config-and-neutral-home.md), [0038](0038-email-verification-required.md), [../self-hosting.md](../self-hosting.md), [../architecture/data-model.md](../architecture/data-model.md) section 14.2, [../../SECURITY.md](../../SECURITY.md), [../../LICENSING.md](../../LICENSING.md)

## Context

The platform review found no Terms, Privacy Policy, footer, contact, or source link anywhere, no consent at sign up, nothing for a creator to accept before connecting Stripe, no seller or refund line at checkout, no way to download your data (REQ-ID-007), and no `security.txt`. A self-hosted operator is the controller for their server but could not link their own texts.

Product decision 1 sets the minimum age to 16, stated in the consent line, with no date of birth. Product decision 2 makes the pages operator configurable: Cloud texts are drafts for legal review, governing law, entity, and data region come from config and show placeholders when unset, and a self-hosted server shows the operator's URLs or a neutral template. Migration 0035 added `users.terms_version`, `users.terms_accepted_at`, `creator_terms_acceptances`, and `communities.refund_policy`.

## Decision

1. **One parse.** `@cohory/config/legal` parses `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`, `LEGAL_IMPRINT_URL`, `LEGAL_GUIDELINES_URL`, `CONTACT_EMAIL`, `SECURITY_CONTACT`, `SECURITY_POLICY_URL`, `SOURCE_URL`, `STATUS_URL`, `LEGAL_ENTITY`, `GOVERNING_LAW`, `DATA_REGION`, and `TERMS_VERSION` with Zod. Pure helpers turn it into links (`legalLinks`), the sign up consent (`signUpConsent`), and absolute URLs for email.
2. **Pages.** `/terms`, `/privacy`, and `/guidelines` redirect to the operator's URL when set. Otherwise Cloud shows a draft with a visible "Draft for legal review" notice and `[... not set]` placeholders, and the Community Edition shows a neutral notice that the people who run the server are responsible (no guidelines link there). `/legal/creator-terms` and `/legal/dpa` exist on Cloud only. No draft is presented as final.
3. **Footer.** One server component on the platform and auth layouts, the 404 page, and the end of About (not on member tabs): Terms, Privacy, and every other link that is set, plus "Powered by Cohory {version}" on self-hosted servers. Error pages get Contact support and Service status when set.
4. **Consent at sign up.** Above Create account: "By creating an account you agree to the Terms and Privacy Policy. You must be 16 or older." On a self-hosted server without its own Terms only the age line shows. When the agreement shows, a Better Auth `user.create.before` hook stores `TERMS_VERSION` and the time; clients cannot set either field.
5. **Creator Terms.** On Cloud, under Connect your Stripe account: "By connecting, you agree to the Creator Terms and the Data Processing Agreement. Payment processing is provided by Stripe under the Stripe Connected Account Agreement." The Payments service enforces it: `connectStripe` refuses with `creator_terms_required` (403) unless the person already accepted the `TERMS_VERSION` the server is configured with, or the call carries `acceptCreatorTerms: true`, which records that version in `creator_terms_acceptances`. A version sent by the caller is never used. REST takes the flag in the connect body; MCP has no tool that connects Stripe. In the web app only the Connect click under the shown terms line sends the flag; Continue onboarding never does, and a refusal opens the updated terms prompt. On Cloud without Creator Terms links, Connect is disabled with a plain message for the operator. When the owner has not accepted the current version, Manage, Payments asks again. The Community Edition has no Creator Terms. Community Guidelines acceptance at creation is a line, not a record.
6. **Checkout.** The small print names the seller (the owner), the creator's refund rule from Manage, Payments (or "Ask the creator for refunds."), and links Terms and Privacy.
7. **Download your data.** Account, Your data asks for a copy. The request is a row in `account_audit_log` (`account.data_export_requested`); one per 24 hours, held by a per account advisory lock so two requests at once cannot both pass. The email goes out after that row commits; if it fails, the request stays and Account, Your data links the copy until it expires and links to `/account/data-export/{id}`, which works for 7 days and only for the signed in account that asked. Each download is rate limited per account (`RATE_LIMIT_DATA_EXPORT_DOWNLOADS`) and writes `account.data_export_downloaded`. The ZIP streams as it is built, reading posts and comments in pages, from the person's own rows only: profile, notification settings, account activity (read in pages into its own file), paid memberships, and per community their membership, posts, comments, RSVPs, course progress, and points. Its README says what is left out: reactions, notifications, uploaded files, and API tokens.
8. **Report content.** `/legal/report` takes a page address, reason, details, and a good faith statement, rate limited per IP, and emails `CONTACT_EMAIL`. A signed in reporter with a confirmed address is the Reply-To and gets a receipt without the page link; the form takes no address, so nobody can send a receipt to someone else. Anyone else sees the confirmation on screen. No table.
9. **security.txt.** `/.well-known/security.txt` from `SECURITY_CONTACT`, falling back to `CONTACT_EMAIL`, with an `Expires` 180 days ahead and `SECURITY_POLICY_URL` as `Policy` when set (never the source address); 404 without a contact.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A checkbox at sign up | Stronger evidence of consent | One more step; decision 1 asks for a plain line | A line next to the button is clickwrap; legal review can ask for a checkbox |
| Date of birth at sign up | Enforces the age | Collects data we do not need | Decision 1 |
| Build the export in a worker and store the ZIP | Matches "a job builds a zip" | A second copy of personal data in storage, a cleanup job, and a new storage key type | Streaming on download keeps no copy, and the link still works for 7 days |
| Signed download link without sign in | Works from any device | A leaked email is a leaked export | The link needs the same account signed in, so it needs no signature |
| A reports table for the public form | Queue in Manage | New table and admin screen | The brief allows no migration; email to the operator is enough for now |
| Default `SOURCE_URL` to the upstream repository | AGPL notice on by default | The public repository address is not decided | The link shows once `SOURCE_URL` is set |

## Consequences

- Positive: every page links Terms and Privacy, operators can publish their own texts without code, and Cloud has a visible place for drafts that legal review will replace.
- Positive: consent, Creator Terms, and data export requests leave records the operator can show.
- Negative: identity reads other modules' tables for the export, as account purge already does; a module export function per table would be cleaner.
- Follow up: legal review of every Cloud text (human gate), the upstream source URL, and a reports queue if volume grows.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Minimum age 16 shown at sign up, no date of birth (founder decision, 2026-10-22). |
| Confirmed | Operator configurable pages, Cloud drafts marked for legal review, placeholders from env (founder decision, 2026-10-22). |
| Recommendation | Export built on download, one request a day, link for 7 days that needs sign in. |
| Open question | Final wording of Terms, Privacy, Guidelines, Creator Terms, and DPA (legal review). |
| Open question | Whether legal review wants a consent checkbox. |
