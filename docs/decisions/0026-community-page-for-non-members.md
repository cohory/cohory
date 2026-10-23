# 0026. Community page for non-members: an About tab first, a join hero, and join continuation after sign up

People who are not members see a join hero and a navbar that starts with About; members keep exactly four tabs. A signed out visitor who presses Join is sent to sign up and the join finishes on its own afterwards.

- ADR status: Draft
- Date: 2026-10-20
- Deciders: Step 17c unit X1 (proposed), founder to confirm
- Related: [../product/information-architecture.md](../product/information-architecture.md), [../product/user-journeys.md](../product/user-journeys.md), [../architecture/authorization.md](../architecture/authorization.md), [0025](0025-reviews-module-boundary.md)

## Context

The founder reviewed 0.10.0 and asked for a simpler community page with no repeated sections that is easy to join (decisions H1 to H7, 2026-10-20). The page showed the community name four times (platform bar, community header, "About {name}", side panel), a stats card, and an info row that repeated the header. The documented rule said members see exactly four tabs and that no feature may add a fifth. H4 adds an About tab for people who are not members, which changes how that rule reads but not what members see.

A visitor who pressed Join while signed out went to sign in with `?next=` set to the About page, and had to press Join again after creating an account.

## Decision

- **Header (H1).** The platform bar holds the brand on the left and, on the right, search (an input from 768px, an icon that opens a search dialog on phones; only where the current community is searchable), the bell, and one avatar menu with Account, Notification settings, Your communities (Home, your communities with unread counts, Create a community), and Sign out. Signed out, a Sign in button replaces the bell and the menu. The chevron switcher and the search box in the community header are removed.
- **Non-member hero (H2).** Anyone who is not an active member sees a hero: cover (since 2026-10-21 at a fixed 4:1 crop, and nothing when there is none), name, "Private · 10 members" (plus the rating from 3 reviews), "By {owner}", the short description clamped to 2 lines on phones and 3 from 768px with a "more" dialog only when it is cut, and the join button for their state. The button is full width on phones and on the right from 768px. The About side panel, its stats card, and the info row are deleted.
- **About section (H3).** Gallery, detailed description, and reviews. "About" stays only as a visually hidden heading.
- **Navigation (H4).** Public community, non-member: About, Community, Classroom, Calendar, Members. `/c/{slug}` without feed parameters redirects a non-member to `/c/{slug}/about`; the Community tab for non-members is `/c/{slug}/feed`, which redirects members to `/c/{slug}`. Classroom and Members carry a lock and render a join prompt with counts only ("2 courses for members", "10 members are here") and the join button. Private community, non-member: no navbar, only About.
- **Members (H5).** A slim cover (removed on 2026-10-21; members see no cover, see decisions log J1), the name, "Public · 10 members", Manage (owner, admins, and moderators, as before) or the "..." menu, then the four tabs. No About tab, no description, no join button. `/c/{slug}/about` still works for members.
- **Preview (H6).** Manage, Appearance links to `/c/{slug}/about?preview=1`. For owners and admins the layout also renders the non-member hero and navbar, and a client component shows them with a Preview banner only on that URL. The server grants and hides nothing in preview: every section keeps its own authorization.
- **Join continuation (H7).** A signed out Join button is a form that posts to `startJoinIntentAction`. The action validates the slug and the intent (`join`, `checkout`, or `request`), sets an httpOnly, SameSite=Lax cookie `cohory_join_intent` for one hour, and redirects to `/sign-up?next=/c/{slug}/join?intent={intent}`. Sign up and sign in keep `next` through `safeRedirectPath` (same origin paths only), and their links to each other carry it. `GET /c/{slug}/join` asks for sign in when there is no session, then acts only when the cookie names the same community and intent, and clears it: `join` joins and lands on the feed, `checkout` creates a monthly Checkout session and redirects to Stripe, `request` sends the request when there are no questions or opens the questions dialog (`/c/{slug}/about?join=request`). Without the cookie it goes to a page with no side effect (About, the questions dialog, or Membership). The decision is a pure function, `planJoinContinuation`, with unit tests.
- Courses gains `countPublishedCourses(actor, communityId)`, readable by anyone who can read the community, so the locked Classroom can show a count without listing course titles.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Join on `GET /c/{slug}/join?intent=join` without the cookie | Simpler | Any site could make a signed in person join a community with one link | The cookie can only be set by our own form post |
| Keep the visitor feed at `/c/{slug}` and link visitors to About | No new route | H4 says non-members land on About, and shared links point at `/c/{slug}` | A redirect makes the landing rule hold for every link |
| Read `?preview` in the layout | One render | Next.js layouts do not receive search parameters | A small client switch over two server rendered tops |
| Show the visitor hero only on About | Less vertical space on other tabs | Visitors on Classroom or Members lose the join button context | Kept on every visitor page; the locked panels repeat the button as the founder asked |

## Consequences

- Positive: one name per zone, one join button in the hero, and a join that finishes after sign up. Members' navigation is unchanged.
- Negative: owners and admins render the visitor hero on every page for the preview switch; non-members have one more redirect on `/c/{slug}`; the locked panels add a second filled button under the hero.
- Follow-up: if sign up starts requiring a confirmed email before sign in, the continuation works only when the confirmation link opens in the same browser (the cookie lives one hour); otherwise the person lands on About and presses Join once more.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | H1 to H7 (founder, 2026-10-20). |
| Recommendation | The cookie gated continuation, the `/c/{slug}/feed` route for visitors, and the client preview switch. |
| Open question | Whether the header Sign in button should return to the current page. |
