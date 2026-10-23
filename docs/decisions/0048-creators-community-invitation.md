# 0048. Creators community link and invitation

When the operator names a creators community with `CREATORS_COMMUNITY_SLUG`, every footer links to it, and each person who creates a community gets one invitation email to join it, sent through the existing invite links.

Status: Accepted, 2026-10-23

- ADR status: Accepted
- Date: 2026-10-23
- Deciders: founder (the link, the timing, once per person, reuse of invite links), coordinator as product owner for the details
- Related: [0033](0033-platform-config-and-neutral-home.md), [0035](0035-email-suppression-and-delivery-headers.md), [0039](0039-legal-pages-and-data-rights.md), [../product/information-architecture.md](../product/information-architecture.md), [../brand/voice-and-tone.md](../brand/voice-and-tone.md)

## Context

The feedback research of 2026-10-23 found that the creators who feel heard are the ones who meet the team where they already are. The cheapest place for Cohory is a community on Cohory itself: "Cohory Creators" on Cloud. People need a way to find it, and new creators need to be asked to join at a moment when they have something to talk about. A self-hosted operator may want the same for their own creators, and nothing may phone home.

## Decision

1. **Config.** `CREATORS_COMMUNITY_SLUG` (optional, a community slug) is read by `@cohory/config/platform` as `creatorsCommunity`. Unset means no link and no email on either edition. It names a community on the same server, so a self-hosted server never contacts cohory.org.
2. **Footer link.** `loadCreatorsCommunityLink()` in `apps/web` reads the community as a guest through the communities service. When it exists, the footer shows its name first, linking to `/c/{slug}`; visitors and people who have not joined land on its About page. When the slug is unset or the community is missing, the footer is unchanged.
3. **When the invitation goes.** A job `communities.creators-invite` runs for a community:
   - 3 days after its owner joined it (the `member.joined` event with role owner; pg-boss `startAfter`),
   - right after a post is published in it (`post.created`), or a course is first published (a new `course.published` event on the `course_events` outbox topic, written by `publishCourse` only when the course was not published before).
   The trigger is an outbox publisher in `@cohory/events`, active only while `CREATORS_COMMUNITY_SLUG` is set. Content triggers are throttled to one job per community per hour.
4. **The rule lives in a service.** `createCreatorsInviteService` in `@cohory/communities/creators-invite` decides. It invites the community's owner unless: the setting is unset; the creators community is missing, archived, or has no owner; the community is the creators community itself; a `created` trigger fires before 3 days have passed; the owner is the creators community's owner; the person was already invited; they are an active member or banned there (by membership or banned email); their account is being deleted; their address is unconfirmed; or their address is suppressed for the server or for the creators community (bounce, complaint, manual entry, or the email opt out link). A skip stores nothing, so a later trigger can still invite.
5. **Reuse invite links, store nothing new.** The invitation is an `invite_links` row in the creators community: created by its owner, one use, no approval, 30 days, labeled "Sent automatically to a new creator", with an `invite.created` audit entry marked `automatic`. Its token is an HMAC of the person's id with `BETTER_AUTH_SECRET`, so the unique token column is the record that the person was invited: a retry, a second community, or a concurrent job finds the row and sends nothing. The email is sent inside the transaction that stores the row, so a failed send leaves no row and the job retries. The accept link is the ordinary `/join/{token}` page. No migration.
6. **Email.** Template `creators-invite`, from the creators community via the instance: what the community is for, that joining is free and the link works once until a date, why the person got it (once, because they created a community), and the one click opt out for that community.

`packages/communities/src/creators-invite/service.test.ts` covers every trigger, once per person, and every skip; the Postgres store has an integration test under row level security, the trigger has unit tests in `@cohory/events`, and `apps/e2e/tests/creators-and-feedback.spec.ts` checks the footer with the setting set and unset.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A new table or column for "invite sent" | Explicit | Needs a migration; one unit owns the only migration in this batch | The invite row already records it |
| A random token and an audit entry as the record | Survives a secret rotation | Needs a lock to stay once under concurrency | The unique token column gives it for free |
| Invite as a system actor | No owner needed | `invite_links.created_by` must be a user | Sent as the creators community's owner |
| Check for a published post or course in the service | Independent of the trigger | Communities would read posts and courses tables | The event that triggers the job already says it |
| A hosted Cohory community for every server | One place for all creators | Phones home from self-hosted servers | Each operator names their own |

## Consequences

- Positive: every creator is asked once, at a useful moment, through a link they already know how to use, and operators can turn it off by leaving the setting empty.
- Positive: owners of the creators community see each invitation in their invite links and audit log.
- Negative: rotating `BETTER_AUTH_SECRET` changes the tokens, so someone who was invited before the rotation can be invited once more.
- Negative: creators of communities that existed before the setting was turned on get the invitation the next time something is published in their community.
- Negative: every published post asks the worker once per hour per community, even after the invitation went out; the job ends after a few reads.
