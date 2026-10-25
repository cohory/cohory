# 0050. Restricted community creation on the Cloud beta, with an early access request

Until Cloud opens to the public, anyone can sign up on cohory.org and join communities, but only approved design partners can create a community, and the Cloud landing page asks other creators to request early access instead of creating a community.

- ADR status: Accepted (founder, 2026-10-25)
- Date: 2026-10-23
- Deciders: founder (restricted creation instead of invite only sign up, early access as the main button, Self-host now as the second, the conditions for opening), coordinator as product owner for the details
- Related: the go to market plan, [0047](0047-cloud-marketing-in-the-app.md), [0048](0048-creators-community-invitation.md), [0049](0049-creator-feedback.md), [../self-hosting.md](../self-hosting.md)

## Context

The go to market plan launches the open source project before Cloud. Cloud cannot take live payments until the external security review and the legal and accounting review are done ([../foundation/roadmap.md](../foundation/roadmap.md)). Until then, Cloud serves 10 hand picked design partners.

Today the Cloud landing page from [0047](0047-cloud-marketing-in-the-app.md) leads with **Create your community**, and anyone can create one. A Show HN post would send strangers into a Cloud that cannot take their money. That also shows a feature as available when it is not, which the brand rules forbid.

A first draft of this record closed sign up for everyone (`SIGNUP_MODE=invite`). The founder rejected it on 2026-10-23: `invite` applies to the whole server, so every member of every design partner community would need an invite link, and share links, posts, and people who find a public community on their own would all hit "You need an invite". That blocks the member growth the partners are there to test.

The pieces for restricting creators instead already exist. `COMMUNITY_CREATION=operators` limits community creation to the accounts whose confirmed email is in `OPERATOR_EMAILS`, and the communities service enforces it for the web app, the REST API (403 `community_creation_restricted`), and MCP.

## Decision

1. **Members sign up freely.** cohory.org keeps `SIGNUP_MODE=open`. Anyone can create an account and join a public community, or a private one through its invite or share link.
2. **Only design partners create communities.** cohory.org sets `COMMUNITY_CREATION=operators` and lists the design partners' confirmed emails, and the founder's, in `OPERATOR_EMAILS`. Adding a partner means adding the address and restarting the app. No new setting.
3. **Design partners are invited to the creators community.** The founder sends each partner an invite link to the creators community named by `CREATORS_COMMUNITY_SLUG` ([0048](0048-creators-community-invitation.md)), or the partner signs up directly. Either way, their email must be in `OPERATOR_EMAILS` before they can create a community.
4. **The landing page follows community creation.** On Cloud, when community creation is restricted (`COMMUNITY_CREATION` is not `anyone`), the `/` and `/pricing` pages replace **Create your community** with **Request early access** and show **Self-host now** (to `/open-source`) as the second button. A signed in person who may create a community still sees Create a community in the app as today. When creation is open to anyone, the pages are unchanged. The decision reads the existing config, so no new flag is needed.
5. **Early access request.** A short form on Cloud collects:
   - an email address,
   - the platform used today (Skool, Circle, other, none), and
   - the number of paying members (none, 1 to 50, 51 to 500, more than 500).
   Answers are emailed to `CONTACT_EMAIL` with Reply-To set to the requester, so the founder can reply by hand. They are not stored in a table; email is enough for the first 10 partners. The form reuses the contact form's spam protection and rate limits ([r62 contact page](../product/feature-inventory.md)) and shows the same confirmation whatever the outcome.
6. **Opening Cloud.** The founder sets `COMMUNITY_CREATION=anyone` when the three conditions in the go to market plan hold: both reviews are done, at least 5 design partners charge members, and the re-subscribe rate is 70% or higher. The landing page switches back with no code change. The change is reversible the same way.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Invite only sign up (`SIGNUP_MODE=invite`), the first draft | Every account is known | Members of partner communities also need invites; share links and public discovery break | Rejected by the founder, it blocks member growth |
| Fully open Cloud with a beta banner | No work | Strangers build on a Cloud that cannot take payments; support load on a solo founder; shows an unavailable feature as available | Breaks the launch order and the brand rules |
| A plain waitlist | Simple | Collects addresses with no signal about who to call | The two questions find Skool creators with paying members to interview |
| A hosted form service | No code | A hosted service as a dependency; data leaves the server | Against the self-hostable default rule |
| A creator allowlist managed in the app | No restart to add a partner | A new table and screen | Not needed for 10 partners; revisit if the list grows |

## Consequences

- Positive: the open source launch can go ahead while Cloud stays closed to new creators, and every Cloud creator is someone the founder has talked to.
- Positive: members of partner communities sign up and join exactly as they will after launch, so the beta tests the real member path.
- Positive: early access answers show the platform and size of interested creators, which feeds the interviews.
- Positive: opening Cloud is one setting change.
- Negative: adding a design partner needs an edit to `OPERATOR_EMAILS` and a restart.
- Negative: any signed in person can still use the rest of Cloud as a member, so moderation of member content applies from day one. The existing reporting and moderation tools cover it.
- Follow-up: the landing and pricing changes, the early access form, its email, and tests in `apps/e2e/tests/cloud-marketing.spec.ts` for restricted and open creation.

## Open questions

| Label | Item |
|---|---|
| Open question | Whether `OPERATOR_EMAILS` should also grant other operator powers once more exist, or a separate creator list is needed. Decided before any new operator power is added. |
