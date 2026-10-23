# 0043. Imports invite people on Cloud, and the owner chooses when import emails go out

On Cloud every imported person is invited instead of added. The owner chooses whether import emails go out now, later, or never, can add a note, preview and test the email, send later from Import history, and resend one person's email from People.

Status: Accepted, 2026-10-23

- ADR status: Accepted
- Date: 2026-10-23
- Deciders: founder (founder decision, 2026-10-22, "importer on Cloud = invite only"), coordinator as product owner for the rest
- Related: [../architecture/archive-format.md](../architecture/archive-format.md) section 5, [../operations/importers/skool.md](../operations/importers/skool.md), [../operations/importers/circle.md](../operations/importers/circle.md), [0042](0042-moving-paying-members.md), the migration UX review of 2026-10-21

## Context

Imports created a passwordless account for everyone without one, made them active members at once, and sent emails only when the owner flipped a switch before the import. On Cloud this added people to a community they never chose to join and created accounts on their behalf. Members got an email that did not say who moved the community or from where, and the "choose a password" link sent them through Forgot password. The owner could not see the email before it went out, could not send it later after checking the result, and could not resend it to one person. The members spreadsheet counted opted out addresses as sent and did not say which rows it skipped.

## Decision

1. **Invite only on Cloud.** On Cloud every person in an archive or a Skool or Circle import, except the importing owner, becomes a placeholder: a new account with the imported name, the address `imported-{id}@import.invalid`, and no password. Their posts, comments, and points are kept under the placeholder, so history shows the right name. A placeholder is never a member: its membership row is stored as `removed` (banned stays banned), so it does not count against the member limit, does not appear in member lists, counts, the leaderboard, or digests, and grants no content access. The id map remembers who was active at the source (`placeholder_member`), and only those people are invited. The same applies to people kept apart on the Community Edition. Their real address is kept in the import's id map (`placeholder_email` entries) and is never written to `users`. Each person gets a single use invite link (30 days) to join with their own account. The preview says "nobody is added as a member until they accept", and the summary counts them as invited, never as new or linked accounts. The Community Edition keeps the earlier rules: confirmed existing accounts are linked and anyone else gets a new account.
2. **When emails go out.** Confirming an import takes `emailChoice`: `now` sends when the import finishes, `later` (the default in the UI) sends nothing until the owner presses "Send the emails" in Import history, and `never` sends nothing. The old `notifyNewUsers` field still works (`true` means `now`). Emails go only to people who were active members at the source; removed, banned, and pending people get none.
3. **One email per person.** The id map records `moved_email` or `moved_email_suppressed` for each person, so retries, a second press of "Send the emails", or a crash in the middle never email anyone twice. Addresses on the suppression list (opted out or bounced) are counted as not sent, in the summary and in the members spreadsheet result.
4. **A direct link.** A new account on the Community Edition gets a link straight to the reset password page with a token stored like Better Auth's own (`reset-password:{token}` in `verifications`), valid 7 days, instead of being sent to Forgot password. Issuing a link deletes the person's earlier reset tokens, so only the newest email works, and setting the password signs out every earlier session (`revokeSessionsOnPasswordReset`).
5. **What the email says.** "{Owner} moved {Community} from {Platform} to Cohory. Your membership came with it", that their posts and comments are already there, and how long the link works. The owner can add a note of up to 500 characters; links and email addresses are removed from it and it is shown as plain text. The members spreadsheet carries the same note in its invitations.
6. **Preview and test.** "Preview email" renders the email for the job with the note, addressed to the owner with a sample link. "Send me a test" sends it to the owner's own address with "Test:" in front of the subject. Both are rate limited like member imports.
7. **Resend one person.** People shows "Resend email" for a person from a finished import who has not yet set a password or accepted the invitation. It sends the email again: the same invitation while it can still be used, or a new choose a password link that replaces the old one.
8. **Owner emails.** The worker tells the owner when an import finishes (with the email outcome), when an import stops for good, and when an export is ready or stops (`migration-import-finished`, `migration-import-failed`, `migration-export-ready`).
9. **Bounds.** On Cloud one import emails at most as many people as the community's plan allows members; the rest are counted as `emailsOverLimit` and shown to the owner. Every community sends at most 1,000 import emails per UTC day (`MigrationConfig.importEmailsPerDay`), counted per day in each import's summary (`emailsByDay`). When the day's budget runs out, the worker reschedules `migration.import-finished` for the next UTC midnight with only the job and community ids in the payload, and a resend that day is refused with `daily_email_limit`.
10. **Who may.** Every new action (send the emails, preview, test, resend, list resendable people) is checked in `@cohory/migration` with `migration.import`, which only the owner has. Callers: the REST routes under `/manage/migration` (`sendImportEmails`, `previewImportEmail`, `sendTestImportEmail`, `resendImportEmail`), the `migration.import-finished` worker job, and the People page (owner only).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep adding people directly on Cloud | People see the community at once | Adds people and creates accounts without their consent on a hosted service | Product decision 16 |
| Link existing Cloud accounts by email | Fewer duplicate rows | Reveals which addresses have an account and joins people without consent | Same as 0042 and the founder decision of 2026-10-21 |
| Email right away by default | Nothing to remember | The owner cannot check the result first | "Later" lets the owner look, then send |

## Consequences

- On Cloud an import adds no real members until people accept, and placeholders never use member slots.
- Owners find placeholders in People under the Removed filter, where Resend email is offered.
- Accepting an invitation creates a membership for the real account; the placeholder's history is not moved to it yet (backlog).
- The reset password page ignores its `next` parameter, so a new account lands on Sign in instead of the community after choosing a password (backlog).

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Imports on Cloud invite people instead of adding them (founder decision, 2026-10-22). |
| Recommendation | Email choice now, later, or never with "later" as the default, the note, preview, test, resend, and owner emails as above. |
| Open question | Claiming a placeholder's history and membership when its invitation is accepted. |
