# Feature inventory

Every planned cohory feature, grouped by module, with its product phase and roadmap phase.

Status: Draft, 2026-10-19 (labels checked against the code for 0.1.0; payments rows checked for 0.5.0; roadmap phase 7 rows checked for 0.8.0; statuses checked against 0.11.0 on 2026-10-23)

Modules match the modular monolith described in the architecture docs (see [../architecture/authorization.md](../architecture/authorization.md) and [../architecture/payments.md](../architecture/payments.md)). Roadmap phases are defined in [../foundation/roadmap.md](../foundation/roadmap.md). MVP boundaries are detailed in [mvp-scope.md](mvp-scope.md).

## How to read this document

- **Phase:** MVP (in the first public release), Post-MVP (planned next, after MVP is stable), Long-term (direction, not committed).
- **Roadmap phase:** 0 Foundation and design, 1 Community core, 2 Classroom and learning, 3 Payments and memberships, 4 Self-hosting and cloud, 5 Migration and portability, 6 Agent integrations, 7 Agent-ready courses.
- **Recommendation:** MVP is the release that completes roadmap phases 1 to 4. A feature in phase 5 or later is Post-MVP or Long-term by definition.
- **Assumption:** events and gamification are placed in phases 2 and 1. If the roadmap moves them, this table follows the roadmap.
- **Recommendation:** "N (follow-up)" means a Post-MVP extension of the module built in phase N, shipped after MVP and not blocking phases 5 to 7. "not scheduled" marks Long-term items with no roadmap phase yet.
- **Built** and **Partly built** at the start of the Notes column mark what exists in code for the 0.1.0 release. Partly built rows say what is missing. Rows without either label are not built yet.

## Founder priority mapping

**Confirmed:** the founder's priority table, mapped to phases.

| Founder feature | Founder priority | Phase | Roadmap phase |
|---|---|---|---|
| Community feed (posts, comments, likes) | Essential | MVP | 1 |
| Courses (modules, lessons, videos) | Essential | MVP | 2 |
| Authentication and member management | Essential | MVP | 1 |
| Gamification (points, levels, leaderboards) | Essential | MVP | 1 |
| Paid memberships (Stripe) | Essential | MVP | 3 |
| Events and calendar | Important | MVP (basic) | 2 |
| Direct messaging | Later | Post-MVP | 1 (follow-up, Recommendation) |
| AI-powered features | Later | Post-MVP (agent API and MCP), Long-term (AI course generation) | 6, 7 |
| Mobile application | Later | Long-term (responsive web in MVP) | not scheduled |
| Plugin marketplace | Later | Long-term | not scheduled |

**Recommendation:** "Important" events ship in MVP in a basic form because Calendar is one of the four confirmed member tabs. Leaving it empty would contradict the navigation.

## Identity

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Email and password sign up | Account with email verification | MVP | 1 | **Built**. Better Auth. When the server sends email, the email must be confirmed before the first sign in; the link lands on `/verified` and works for 1 hour ([0038](../decisions/0038-email-verification-required.md)). Operators can limit sign up to active invite links, or close it (`SIGNUP_MODE`), and limit community creation to listed operators (`COMMUNITY_CREATION`, `OPERATOR_EMAILS`); the server enforces both. A sign up or sign in that continues a join names the community and the next step, including the price for a paid join |
| Magic link sign in | Passwordless sign in by email | MVP | 1 | **Built** for existing accounts when the server sends email: "Email me a sign in link" on sign in, 15 minutes, single use ([0038](../decisions/0038-email-verification-required.md)) |
| Change email address | Move the account to a new address | MVP | 1 | **Built** when the server sends email: Account, Security asks the current address to approve the change, then sends a link to the new address; the address changes after the new one is confirmed, and every other device is signed out ([0038](../decisions/0038-email-verification-required.md)) |
| Password reset | Email-based reset | MVP | 1 | **Built** |
| Platform profile | Name, username, avatar, bio, links | MVP | 1 | **Partly built** (name, username, and avatar on Account; bio is per community; no links). One profile across communities |
| Session management | Sign out everywhere, active sessions list | MVP | 1 | **Built**. Account, Security lists active sessions (device read from the browser, last active, this device first) with Sign out per device and Sign out all other devices. Changing the password there signs out every other device, and changing or resetting it also revokes the person's API tokens, agent tokens, and connected apps (security audit run 1, 2026-10-21). No location is shown |
| Account deletion | Delete account and personal data | MVP | 1 | **Built**. Account, Danger zone asks for the email address, signs out every device, and schedules erasure 14 days later; signing in before then shows Cancel deletion. An hourly job then removes personal data and keeps posts and comments under the name Former member. Blocked while owning a community that is not archived, or an archived one that still has active subscriptions or an open Stripe connection (Step 18); the Danger zone links each one to its Settings or Payments page. Before erasing, it cancels open paid subscriptions and deletes the Stripe customer in each community; if Stripe fails, the account waits for the next run. The panel says payment records stay with Stripe and the creators you paid, and links Privacy ([0039](../decisions/0039-legal-pages-and-data-rights.md)) |
| Download your data | Copy of your own data as a file (REQ-ID-007) | MVP | 1 | **Built**. Account, Your data emails a link to a ZIP of the person's profile, notification settings, account activity, paid memberships, and per community their membership, posts, comments, RSVPs, course progress, and points. One request a day; the link works for 7 days and only for the same signed in account; downloads are streamed, rate limited, and recorded in the account activity ([0039](../decisions/0039-legal-pages-and-data-rights.md)) |
| Terms, Privacy, and consent | Legal pages, footer, and consent at sign up | MVP | 4 | **Built**, texts await legal review before a public Cloud launch. Pages show "Last updated {date}" (`LEGAL_UPDATED_AT`) and no draft notice. Footer on platform, auth, 404, and About pages; `/terms`, `/privacy`, `/guidelines` from operator URLs, Cloud drafts, or a neutral template; "You must be 16 or older" at sign up and the Terms version stored on the account; `/legal/report`; `/contact`, a form that emails the operator with the sender's account details when signed in, spam protected and rate limited, linked as Contact in the footer and as Send feedback (topic and page prefilled) in the avatar menu, Manage Overview, and error pages; `/.well-known/security.txt` ([0039](../decisions/0039-legal-pages-and-data-rights.md)) |
| Creators community | A link to the operator's creators community and one invitation for each new creator | MVP | 1 | **Built** (after 0.11.0). With `CREATORS_COMMUNITY_SLUG` set and the community present, every footer links to it, and each person who creates a community gets one invite link email after their first published post or course, or after 3 days; skipped for members, banned people, its owner, unconfirmed addresses, and opted out addresses ([0048](../decisions/0048-creators-community-invitation.md)) |
| Social login (Google, Apple, GitHub) | OAuth sign in | Post-MVP | 5 | Self-hosters configure their own OAuth apps |
| Two-factor authentication | TOTP for accounts | Post-MVP | 5 | Recommendation: required for owners on Cloud later |
| SSO (SAML, OIDC) for organizations | Enterprise sign in | Long-term | not scheduled | |
| Agent identities | Non-human identities with scoped tokens | Post-MVP | 6 | Never unrestricted financial or admin scopes. **Built** (since 0.6.0): owned by one person in one community, managed in Manage, Settings, Agents (create, scopes, tokens, pause, resume, revoke); effective permission is the agent's scopes and its owner's current role, checked on every request. See [Personal and agent API tokens](#agent-integrations) |

## Communities

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Create community wizard | Name, slug, free or paid, logo and accent | MVP | 1 | **Partly built** (name, URL with the full address, a live availability check and three suggestions, description, privacy, and Free or paid; Paid opens Manage, Payments with the Payment account card highlighted after creation and the choice is not stored; price, logo, and accent are set later in Manage). See [user-journeys.md](user-journeys.md) journey 1 |
| Community URL change | The owner changes the slug after creation | Post-MVP | 6 | **Built** (founder decision S1, 2026-10-21). Manage, Settings, Community URL; owner only, once every 30 days, recorded in the audit log. Old URLs answer 308 to the new slug for pages and `/api/v1/communities/{slug}/...`, and old slugs stay reserved for the community. Agents and API tokens cannot change it |
| About page | Public page with description, cover, price, Join | MVP | 1 | **Built**. Indexable by search engines. Since Step 17: gallery (up to 10 images and YouTube, Vimeo, or Loom links, first item is the hero) and a detailed description in the post format, managed in Manage, Appearance. Since Step 17c (H2 to H6): non-members see a hero (cover at 4:1 since 2026-10-21, name, privacy and member count, rating from 3 reviews, "By {owner}", the clamped short description with "more", and the join button) and land on About, the first of five tabs on a public community or the only page of a private one; the side panel and the info row are gone; Classroom and Members show join prompts with counts; members have no About tab; owners and admins preview it from View About page. Since 2026-10-21 gallery videos never autoplay, and a public community's cover is its link preview image. Since 2026-10-21 ([0036](../decisions/0036-about-page-that-sells.md)): a join bar on phones, a sticky join card from 1024px, a closing call to action, the yearly price and "Cancel anytime." under a paid button, a join button in the "more" dialog, What you get (owner lines or honest counts, also on the Membership page), About the host, Questions, an "About {name}" title with the short description as meta description and the cover as preview image (public communities only, [0041](../decisions/0041-private-community-link-previews.md)), and one Page text form in Manage, Appearance |
| Privacy | Private (About only) or public (read-only feed preview) | MVP | 1 | **Built**. Default private. Since Step 17c a signed out Join continues after sign up: free communities join, paid ones open Stripe Checkout, and approval communities send the request or open the questions |
| Join modes | Open, approval required, invite only | MVP | 1 | **Built** (set in Manage, Settings, Joining; new private communities start with approval, new public ones with open join; requests are approved or declined in Manage, People, Requests with an optional note shown to the person on the About page; invite links skip approval unless the link asks for it). Paid communities use checkout. Moderators, admins, and the owner are notified of each request, and the person who asked is notified of the answer, in the app and by email |
| Join questions | Up to 3 free-text questions | MVP | 1 | **Built** (each question can be required; answers are visible only to moderators, admins, and the owner) |
| Categories | Creator-defined post categories, up to 10 | MVP | 1 | **Built** (name, color, order, staff only posting; managed in Manage, Settings, Categories and reached from "Edit categories" in the feed chip row; new communities start with General, Introductions, and Announcements, which is staff only; deleting a category moves its posts and drafts to General, or leaves them without a category when General itself is deleted or no longer exists). Staff only categories are labeled "Only staff can post": staff post, everyone reads (founder decision, 2026-10-19) |
| Community switcher | Move between my communities | MVP | 1 | **Built**. Since Step 17c (founder decision H1) it is the Your communities group in the avatar menu: Home, then every community where you are an active member or on the team with unread counts and the current one checked, then Create a community. The chevron button from 0.10.0 is gone. Since 0033, Home opens `/?home=1`, because `/` takes a person with one community straight into it. My communities cards show the number of new notifications and are one link each with no Open button (F5) |
| Platform header | Brand, switcher, bell, and avatar menu on every page | MVP | 1 | **Built**. Since 0.10.0 (founder decisions F1, F2, F4): outside a community the Cohory app icon and the wordmark "Cohory" link to Home; inside a community the community logo (or a generated initial) and name link to the community feed. The Account text link is gone; Account stays in the avatar menu. Since Step 17c (H1): the right side holds search (a field from 768px, a search dialog on phones, only inside a searchable community), the bell, and one avatar menu with Account, Notification settings, Your communities, and Sign out; signed out, a Sign in button |
| Transfer ownership | Owner hands the community to an admin | MVP | 1 | **Built**. The payment connection stays (Stripe accounts cannot move). Since Step 18 new checkouts pause until the new owner keeps the previous owner's Stripe account or disconnects it and connects their own; both people get a notice |
| Archive community with paying members | Owner chooses what happens to paying members on archive | MVP | 1 | **Built** (Step 18). The archive dialog counts paying members and offers Stop at period end (default) or Keep billing, and can leave subscriptions linked from before Cohory running. New checkouts and plan changes are closed while archived; the customer portal stays open. Members get an in-app notice and an email. Archiving again switches Keep billing to Stop at period end; restoring says how many subscriptions are set to end. Not built: Resume renewals |
| Delete community | Permanent deletion after confirmation | MVP | 1 | **Built** (only after the community is archived). Since Step 18 it cancels every paying member's subscription at once without proration first, keeps members' access until that is done, and keeps payment records and platform invoices with the community name. Blocked while a Cohory invoice is unpaid; asks the owner to confirm cancelling in the Stripe Dashboard when Stripe is disconnected. The community disappears at once; a worker job removes its data in batches within about a minute, and its URL stays taken until then. Recommendation: 14-day soft delete |
| Custom domains | Map a domain to the community root | MVP | 4 | Not built. Only the `custom_domain` permission exists in `@cohory/authz`. Cloud and self-hosted |
| Multiple communities per instance | One self-hosted install hosts many | MVP | 4 | **Built** (no default community setting for single-community installs yet) |
| Community directory | Public list of communities | Long-term | not scheduled | Deliberately excluded from MVP |
| Cloud marketing pages | Creator landing at `/`, Pricing, and Open source on Cloud | MVP | 4 | **Built** (0.11.0, [0047](../decisions/0047-cloud-marketing-in-the-app.md)). Cloud Edition only; the Community Edition keeps the neutral home and answers 404. The fee and the fair use limits on the pages are read from config. While `COMMUNITY_CREATION=operators`, the pages ask for early access instead ([0050](../decisions/0050-restricted-cloud-community-creation.md)) |
| Early access request | `/early-access` on Cloud: email, platform today, paying members, optional note, emailed to `CONTACT_EMAIL` with the requester as Reply-To | MVP | 4 | **Built** ([0050](../decisions/0050-restricted-cloud-community-creation.md)). No table; shares the contact form's spam checks and rate limits through `packages/notifications/src/public-form`. Linked from the landing and pricing while creation is restricted, and from the home page, avatar menu, and `/communities/new` for a signed in person who may not create a community |

## Members

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Member directory | Searchable list with filters | MVP | 1 | **Built** (search and level filter) |
| Member profile in community | Bio, level, points, joined date, recent posts | MVP | 1 | **Built** |
| Roles | Owner, admin, moderator, member | MVP | 1 | **Built**. Guest is the non-member state |
| Pending requests | Approve or reject with answers shown | MVP | 1 | **Built** (Manage, Inbox, Requests, and `GET /api/v1/communities/{slug}/manage/requests` with approve and decline) |
| Invite link | Shareable, revocable link | MVP | 1 | **Built**. Since the review of 2026-10-21, links take an optional name, and revoked or expired links stay listed with their use counts. The invite page shows the community card (cover, logo, members, price, owner, description), leads with "Create account and join", accepts the invite after sign up or sign in without a second press, and previews in chat apps as "Join {community} on {instance}" (a private community shows only the instance name) |
| Email invites | Invite by email address list | Post-MVP | 5 | Pairs with migration |
| Remove and ban | Remove member, ban from rejoining | MVP | 1 | **Built** |
| Members CSV export | Owner export with Stripe IDs | MVP | 3 | **Built**. Recommendation. Since 0.6.0 it follows the People filters (search, role, membership, inactive days) and ends with a `last_active_at` column. Since the review of 2026-10-21 it also has `access` (paying_monthly, paying_yearly, free_access, past_due, cancelling, or none) and `signed_in` (yes or no), and filters by both |
| Inactive members | Find members with no activity in N days | Post-MVP | 6 | **Built** (since 0.6.0, REQ-MEM-008). Manage, People, "Last active" filter (7, 14, 30, 60, 90, or any number of days) for moderators, admins, and the owner; the owner downloads the filtered list. Activity is the latest post, comment, like, lesson progress, or RSVP in the community, or a sign in anywhere on the platform (sessions are not tied to one community). REST: `GET /api/v1/communities/{slug}/manage/people?inactiveDays=N`. A daily job fills in the last activity of members who had none recorded |
| Online indicator | Shows members active in the last 5 minutes | Post-MVP | 1 (follow-up) | |
| Member tags and segments | Creator-defined tags | Post-MVP | 1 (follow-up) | |

## Posts

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Composer | Title (optional), body, category, images | MVP | 1 | **Built**. One or two interactions to post. Staff only categories are offered only to moderators and above. Images can also be pasted or dropped into the composer |
| Rich text | Bold, italic, lists, links, quotes, code | MVP | 1 | **Built** (stored as a JSON document plus sanitized HTML, [ADR 0012](../decisions/0012-post-content-format.md)) |
| Images | Up to 10 per post | MVP | 1 | **Built**. S3-compatible storage |
| Video embeds | YouTube, Vimeo, Loom, Wistia URLs render inline | MVP | 1 | **Built**. Allowlisted providers |
| Links | Auto-linked URLs | MVP | 1 | Generic link preview cards are Post-MVP |
| Mentions | `@username` with notification | MVP | 1 | **Built**. Typing `@` and a few letters suggests members by name with their avatar; picking one inserts the mention. A mention that matches no member is called out under the text, since nobody gets notified |
| Likes | Like a post | MVP | 1 | **Built**. Drives points |
| Pin posts | Up to 3 pinned posts at top of feed | MVP | 1 | **Built**. Admins and owner |
| Edit and delete | Own posts, or any post for moderators and above | MVP | 1 | **Built** (moderators and above can open deleted posts). "Edited" label |
| Feed sorting | Latest activity (default), New, or Top | MVP | 1 | **Built** (Active orders by the latest comment, Newest by creation, Top by likes plus comments counted twice over the last 7 days; pinned posts stay on top; `?sort=new` or `?sort=top` in the URL). Top is a visible count, not a personalized ranking |
| Category filter | Filter feed by category | MVP | 1 | **Built** (chips above the composer, `?category={slug}` in the URL) |
| Community search | Search posts, comments, members, and lessons | MVP | 1 | **Built** (PostgreSQL full text search, results grouped by type with highlighted excerpts, search field in the platform bar (a search dialog on phones) and `/c/{slug}/search`; drafts, deleted posts, and lessons the person cannot open are left out; rate limited) |
| Email to all members | Send a post as an announcement email | MVP | 1 | **Built**. Owner and admins tick Also email all members in the composer, which shows when it was last used. Once per 24 hours per community, not for scheduled posts. The worker emails active members with a confirmed address who can open the community, except the sender, and skips addresses that opted out of the community or are suppressed; each email has a link to stop emails from that community. Delivery is at most once: a run that fails is not retried, so nobody gets it twice |
| Report post | Members flag content for moderators | MVP | 1 | **Built** for posts and comments: Report in the item menu, a reason (spam, harassment, hate speech, sexual content, violence, something else) and an optional note. Reporters stay anonymous to the moderators. Not offered on your own content. Limited to 10 reports per 10 minutes |
| Follow post | Get notified on new comments | MVP | 1 | **Built**. Follow on the post page; commenting follows the post. Followers get Comments on posts you follow (in the app, and in the daily summary by default) while they can still open the community; a follower who lost access, for example when a paid membership lapsed, gets no further notices and can still unfollow |
| Conversation life | Show which posts have new activity | MVP | 1 | **Built**. Feed cards show up to 3 recent commenters, when the last comment came, and New for posts with activity since your last feed visit (the visit is recorded once the feed has shown, so loading more posts keeps the same markers). Posts and comments by staff carry a Creator, Admin, or Moderator badge |
| Feed side panel | Context next to the feed on wide screens | MVP | 1 | **Built**. From 1024px the feed is about 640px wide with a panel for Continue learning, the next event, the top 5 of the 7 day leaderboard, and new members |
| Polls | Multiple-choice polls | Post-MVP | 1 (follow-up) | |
| File attachments on posts | PDFs and other files | Post-MVP | 1 (follow-up) | |
| Scheduled posts | Publish at a set time | Post-MVP | 6 | **Built** (since 0.6.0, REQ-POST-010). "Publish on" in the composer takes a date and time in the member's time zone, 1 minute to 365 days ahead, with Tomorrow 09:00 and Monday 09:00 shortcuts. After scheduling, a message names the day and time with a View link. Scheduled posts stay out of the feed, search, profiles, and stats; the author (and moderators, admins, and the owner for everyone's) sees them at `/c/{slug}/posts/scheduled` with Post now (after a confirmation), Edit or reschedule (the full composer, including category and images), and Delete. A job publishes due posts every minute, exactly once, and notifications and webhooks fire at publish time. If the author left, lost the right to post in the category, or the community was archived, the post is discarded instead. REST: `scheduledAt` on create and `/api/v1/communities/{slug}/scheduled-posts`. Also used by agent approval flow later |
| Drafts awaiting approval | Agent or member drafts reviewed by admins | Post-MVP | 6 | **Partly built** (since 0.6.0): posts by agents wait under Drafts waiting for you on the Agents page until the owner or an admin publishes or discards them. Member drafts reviewed by admins are not built |

## Comments

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Comment on post | Plain rich text with mentions | MVP | 1 | **Built** |
| Replies | One level of nesting | MVP | 1 | **Built** |
| Like comment | Like a comment | MVP | 1 | **Built**. Drives points |
| Edit and delete | Own comments, or any for moderators | MVP | 1 | **Built** |
| Images in comments | One image per comment | Post-MVP | 1 (follow-up) | |
| Lesson comments | Discussion under each lesson | Post-MVP | 1 (follow-up) | Recommendation: reuse comment threads |

## Courses

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Course list | Cards with cover and progress | MVP | 2 | **Built** |
| Create course | Title, description, cover | MVP | 2 | **Built**. In Classroom, not Manage |
| Modules | Ordered groups of lessons | MVP | 2 | **Built** |
| Draft and published | Per course and per lesson | MVP | 2 | **Built**. One publish dialog per course: lesson counts, "Publish draft lessons too", an optional feed announcement, and a refusal when no lesson would be visible. Lessons publish from their editor or the outline menu |
| Reorder | Drag and drop modules and lessons | MVP | 2 | **Built** (drag and drop plus keyboard, focus kept on the moved item). Lessons move to another module from the row menu; dragging across modules is not built |
| Outline editing | Sketch modules and lessons in place | MVP | 2 | **Built**. Inline lesson titles, duplicate a lesson as a draft, agent panels in one closed "Agents" section until a lesson has agent material |
| Progress tracking | Percent complete per member | MVP | 2 | **Built** |
| Access: all members | Every member can open published courses | MVP | 2 | **Built**. Only access mode in MVP (Recommendation) |
| Access by level | Unlock at a gamification level | Post-MVP | 2 (follow-up) | **Built** ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)). A course can be locked until a level; members below it see it locked without its lessons, and moderators, admins, and the owner always open it. The lock applies only while levels are on |
| Access by membership tier | Course tied to a tier | Post-MVP | 2 (follow-up) | Needs multiple tiers |
| One-time course purchase | Buy a single course | Post-MVP | 2 (follow-up) | |
| Drip schedule | Unlock lessons over time | Post-MVP | 2 (follow-up) | |
| Certificates | Completion certificate | Long-term | not scheduled | |
| Agent-readable course export | Structured lessons for agents | Long-term | 7 | **Built** (since 0.8.0): optional agent layer per lesson (objective, instructions, references, templates, tasks with JSON Schemas, evaluations), immutable semantic versions, read API for agents, and MCP tools for delegated agents (since 0.8.0). Format: [../architecture/agent-course-format.md](../architecture/agent-course-format.md) |

## Lessons

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Video by URL | Embed from allowlisted providers | MVP | 2 | **Built**. No video upload or transcoding in MVP |
| Markdown body | Text, images, code blocks | MVP | 2 | **Built** |
| Attachments | Files up to 25 MB each, 10 per lesson | MVP | 2 | **Built** (original filename kept for downloads). Recommendation |
| Mark complete | Manual completion | MVP | 2 | **Built** |
| Next and previous | Sequential navigation | MVP | 2 | **Built** |
| Lesson sidebar | Course outline beside the lesson | MVP | 2 | **Built**. Collapsed on mobile |
| Resume card | "Continue" chip on the feed | MVP | 2 | **Built**. Confirmed principle. Shares one compact row with the next event chips |
| Member onboarding | "Start here" welcome card, first post prompt, welcome email, checkout success steps | MVP | 2 | **Built**. Card for 14 days, dismissed per membership; one welcome email per membership 2 minutes after activation |
| Video upload and hosting | Upload video to storage | Post-MVP | 2 (follow-up) | Storage and bandwidth cost on Cloud |
| Quizzes | Questions with answers | Post-MVP | 2 (follow-up) | |
| Structured lessons for agents | Instructions, references, tasks, evaluations | Long-term | 7 | **Built** (since 0.8.0) with the agent layer above. Evaluations run in the agent's own environment and results are self reported; design and the reference runner `@cohory/agent-runner` (JSON Schema checks only, never scripts): [../architecture/evaluation-runner.md](../architecture/evaluation-runner.md) |
| SKILL.md generation | Convert a course into Agent Skills | Long-term | 7 | **Built** (since 0.8.0): deterministic zip per published version with SKILL.md, references, templates, tasks, evaluations as data, and a checksummed manifest; Draft from lesson builds a draft without AI services. Downloaded skills are untrusted input. Delegated agents and people with course access get the zip through a signed link valid for 5 minutes (since 0.8.0) |

## Events

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Create event | Title, time, duration, location or meeting URL | MVP | 2 | **Built**. In Calendar, with a searchable time zone field, a line that says when the event happens, a cover image, a draft kept on the device, and an optional "New event" notice to members |
| Weekly recurrence | Repeat weekly with optional end date | MVP | 2 | **Built** (26 weeks of occurrences are generated ahead). Recommendation. Other patterns Post-MVP |
| Cancel occurrence | Cancel one date in a series | MVP | 2 | **Built** |
| Month and list views | List default on mobile | MVP | 2 | **Built**. Desktop starts with the next event; both show past events with recording links |
| Local time display | Viewer's time zone | MVP | 2 | **Built** |
| RSVP | Going or not going | MVP | 2 | **Built**. Up to 5 faces of members going; an email confirmation with a calendar invite |
| Reminder email | One hour before, RSVP'd only | MVP | 2 | **Built**. In the app and by email, in the member's time zone first. Email is on ("immediate") by default and follows the Event reminders setting. Sent only to confirmed addresses (founder decision, 2026-10-19); a member who confirms before the event still gets it |
| Add to calendar | .ics download | MVP | 2 | **Built** |
| Calendar feed sync | Subscribe URL for Google or Apple Calendar | Post-MVP | 2 (follow-up) | |
| Native video rooms | Built-in live video | Long-term | not scheduled | Use external meeting links |
| Paid events | Ticketed events | Long-term | not scheduled | |

## Gamification

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Points from likes | 1 point per like received on a post or comment | MVP | 1 | **Built**. No points for posting itself (anti-spam) |
| Levels | 9 levels with fixed thresholds | MVP | 1 | **Built**. Thresholds in [mvp-scope.md](mvp-scope.md) |
| Level names | Creator renames the 9 levels | MVP | 1 | **Built**. In Settings |
| Leaderboards | Rolling 7-day and all-time | MVP | 1 | **Built**. 30-day Post-MVP |
| Level badge on avatar | Small number badge | MVP | 1 | **Built** (level badge next to author names) |
| Points reset | Admin resets one member | MVP | 1 | **Built**. Manage, Settings, Points and levels, Reset points sets every member back to zero and level 1 after typing the community name; the history is kept and the reset is in the audit log; removing a like awarded before the reset does not take points below zero. Resetting one member is built too (since 0.9.0): Manage, People, the member's menu, Reset points, for admins and the owner; it is audited as `points.reset_member` and only that member's earlier likes are protected from a second charge |
| Custom point rules | Points for lessons, events | Post-MVP | 1 (follow-up) | **Built**, off by default ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)). 1 point per finished lesson and per attended event, each counted once, awarded by a worker job within about 15 minutes. An owner or admin turns on Each lesson a member finishes or Each event a member attends in Manage, Settings, Points |
| Badges | Achievements | Long-term | not scheduled | Candidate for plugins |

## Reviews

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Member reviews | 1 to 5 stars and 20 to 2000 characters on the About page | Post-MVP | 3 (follow-up) | **Built** in Step 17 (0.10.0). Off by default; the owner or an admin turns it on in Manage, Settings, Reviews, and turning it off hides reviews but keeps them. Members who have paid for at least 30 days can leave a review (an active, paid, recurring subscription; trials, past due, comps, and one time purchases do not count; role does not matter). One review per member, edit (shown as edited) and delete; a quiet status per review ("Paying member for 7 months" or "Former member"); average from 3 reviews; filter by stars; newest first. Reviews of removed or banned members are hidden; erased accounts show Former member. Agents and API tokens can read but never write |
| Owner reply | One public reply per review | Post-MVP | 3 (follow-up) | **Built** in Step 17. Owner only, edit and delete |
| Review moderation | Report and hide | Post-MVP | 3 (follow-up) | **Built** in Step 17. Anyone signed in can report a review; reported reviews appear in Manage, Inbox, Reports. Only the owner can hide a reported review, with a reason (spam, abuse, personal data, off topic), recorded in the audit log and shown on the About page as "1 review hidden by the owner for: spam". Nobody can edit or delete another person's review |

## Payments

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Connect your Stripe account | Stripe Connect onboarding (Cloud) | MVP | 3 | **Built**. Direct charges on connected account. The owner accepts the Creator Terms and Data Processing Agreement (drafts for legal review) by connecting; the version is recorded and asked again when it changes ([0039](../decisions/0039-legal-pages-and-data-rights.md)) |
| Self-hosted Stripe keys | Creator's own Stripe API keys | MVP | 3 | **Built**. No platform fee |
| Platform fee 2% | Application fee on successful Cloud transactions | MVP | 3 | **Built**. Processing fees separate. Rate set in [ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md); a subscription keeps the rate it was created with |
| Fee ledger | Record of every platform fee | MVP | 3 | **Built**. Basis for periodic platform billing (0.5.0) |
| Stripe Checkout | Hosted payment page | MVP | 3 | **Built**. The Membership page names the seller and the creator's refund rule (set in Manage, Payments) before checkout ([0039](../decisions/0039-legal-pages-and-data-rights.md)) |
| Payments list | Recent payments in Manage | MVP | 3 | **Partly built** (paid members and totals per currency in Manage, Payments). Read from local records |
| Webhook processing | Idempotent, reconciled | MVP | 3 | **Built** (idempotent inbox; a daily `payments.reconcile` job at 03:45 checks each connection against Stripe). See [../architecture/payments.md](../architecture/payments.md) |
| Bring Your Own Payment Provider | Other providers, ledger billing when no split | Post-MVP | 5 | **Built** for Polar on both editions (REQ-PAY-008), off by default since [ADR 0027](../decisions/0027-safe-exit-and-2-percent-fee.md) (`COHORY_ENABLE_POLAR`) because Polar's acceptable use policy does not allow community access. Limits: no fee split, so Cloud records the 2% as `fee_accrued` and bills it monthly; no linking of existing Polar subscriptions; refunds from cohory, disputes, and trials not built; live Polar sandbox run pending. See [../operations/payment-providers.md](../operations/payment-providers.md) |
| Periodic platform billing | Invoice creators for ledger fees | Post-MVP | 5 | **Built** (since 0.5.0). Monthly Stripe invoice per community and currency on the platform account, 5 USD equivalent minimum with carry forward, card on file or an invoice Stripe emails with its PDF (no second copy from cohory), daily reconciliation, new paid signups on Polar paused after 30 days past due (Stripe Connect checkout stays open, existing members keep access). Manage, Payments, Platform fees. See [platform-billing](../operations/platform-billing.md) |
| Coupons and discounts | Promotion codes | Post-MVP | 3 (follow-up) | |
| Tax handling guidance | Stripe Tax configuration help | Post-MVP | 3 (follow-up) | Open question on fee base |

## Subscriptions

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Monthly and annual prices | One paid plan per community | MVP | 3 | **Built**. Single currency from Stripe's 24 settlement currencies, each price at least Stripe's minimum charge. Renaming the plan renames the Stripe Product |
| Subscription sync | Status from Stripe webhooks | MVP | 3 | **Built** |
| Customer portal | Cancel and update card via Stripe | MVP | 3 | **Built** |
| Account billing | Every paid membership in one place | MVP | 1 | **Built** (Step 18). Account, Billing (`/account/billing`) lists each paid membership with plan, price, status, and the next charge or end date. Manage billing opens the Stripe customer portal while the connection is open; otherwise the row says "Billed directly by {community}" with the creator's support contact. Archived and disconnected communities stay listed until the subscription ends, and so do communities the member was removed from while the subscription still bills. Manage billing returns to Account, Billing (since 0.11.0) |
| Cancel at period end | Access until the paid period ends | MVP | 3 | **Built** |
| Fair cancel screen | Usage, access end, optional reason, and switch to yearly, pause, or cancel with equal weight | MVP | 3 | **Built** (0.11.0, [0040](../decisions/0040-fair-cancel-and-pause.md)). The reason goes to Stripe `cancellation_details`; cancel finishes in the portal's cancel flow |
| Pause payments | Stop charging for 1 to 3 months | MVP | 3 | **Built** (0.11.0). Stripe `pause_collection` with voided invoices; access lasts until the paid period ends and returns on resume |
| Yearly renewal reminder | Email 7 days before a yearly plan renews | MVP | 3 | **Built** (0.11.0). Daily job, one email per subscription and renewal date |
| Past due handling | Banner and email, access kept | MVP | 3 | **Built** (banner and access kept; since 0.11.0 the member gets an email and a notice for each failed payment with the next retry date). Recommendation |
| Free trials | Trial days before first charge | Post-MVP | 3 (follow-up) | |
| Multiple tiers | Several paid plans | Post-MVP | 3 (follow-up) | |
| Import existing subscriptions | "Bring your existing subscribers" | Post-MVP | 5 | **Built** (since 0.4.0). Community Edition only since [0042](../decisions/0042-moving-paying-members.md): Cloud's connected account is always new, so Cloud shows Move paying members instead. Only subscriptions the creator's own account created; match by confirmed email, invite otherwise. See [payment-migration](../operations/payment-migration.md) |
| Paying members to move | Free time until the old renewal date, and who has moved | Post-MVP | 5 | **Built** ([0042](../decisions/0042-moving-paying-members.md)). A list on "Bring your existing subscribers" filled by pasting addresses and dates or from the last Skool, Circle, or archive import; Checkout gives each person a free period until their date; the list shows Not moved yet, Moved, or Free time ended; "Email everyone not moved yet" sends the `moving-offer` email at most once a week per person |
| Remove platform fees on disconnect | Stop future application fees when the payment account is disconnected | MVP | 3 | REQ-PAY-010. **Built** (Step 18): the fee is removed and checked before the connection closes, the owner chooses Take my members with me or Wind down, members are told, fees received afterwards are refunded, and paid access ends at each member's period end ([payments.md](../architecture/payments.md) section 13.8). Full Cloud to self-hosted offboarding tooling is Phase 5 |

## Entitlements

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Community access entitlement | Derived from free or paid membership | MVP | 3 | **Built** (derived on read, no entitlements table yet). Single source of truth for access checks |
| Comped access | Owner grants free access to a paid community | MVP | 3 | **Built**. Owners and admins grant it by email in Manage, Payments, Free access (or by user id through the API), with an optional end date and note, and can revoke it. On Cloud an email grant is an offer ("Send offer") that the person accepts on their membership page ("Accept free access"), pending offers can be withdrawn, and a user id must belong to a member of the community. Shown with a Comped badge. It counts as an active membership until it ends; an hourly job ends expired grants |
| Course entitlements | Per-course access | Post-MVP | 3 (follow-up) | |
| Delegated agent access | Owner delegates a course entitlement to an agent (REQ-ENT-004) | Long-term | 7 | **Built** in 0.8.0. Creators turn on Allow agent access per course (off by default) and pick license terms; a member with access gives one of their own agents read access for 30 days from the course page, and renews or revokes it there or in Account, Agents. Access is derived from the member's own access on every request and ends with it (and does not come back with a later membership), with expiry, revocation, a revoked agent, or the creator turning access off; pausing the agent pauses it. Agents can propose a purchase that the member approves into Checkout, and submit self reported results. Agents read through MCP tools (since 0.8.0), and an agent whose person's membership ended can still propose buying it back. Guide: [../operations/agent-courses-delegation.md](../operations/agent-courses-delegation.md) |

## Notifications

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| In-app bell | Community-scoped list with unread count | MVP | 1 | **Built** |
| Email for replies and mentions | Batched every 15 minutes | MVP | 1 | **Built** differently: mentions, replies, and comments on your posts are emailed about 3 minutes later, merged into one email per post (titled by the post, with the comment or post text quoted), or collected into a daily summary grouped by community, per type. Every email has a signed unsubscribe link, valid for a year, and one click unsubscribe headers. No 15 minute batch. Only confirmed addresses get these emails (founder decision, 2026-10-19), and Account asks people to confirm theirs |
| Transactional emails | Verification, receipts, payment problems | MVP | 1, 3 | **Partly built** (verification, password reset, event reminder, failed payment, renewal reminder, and paid membership change emails; receipts come from Stripe). Cannot be disabled |
| Per-community preferences | All, Important only, None | MVP | 1 | **Partly built**. Account, Notifications sets each type for every community at once: in the app on or off, email right away, daily summary, or off. Defaults: mentions, replies, join requests for the owner, and answers to your join requests right away; comments on your posts, and join requests for admins and moderators, in the daily summary at 08:00. The page shows Right away for join requests to someone who owns a community and Daily summary to everyone else, until they choose. Per community settings and the three levels are not built |
| Daily or weekly digest | Summary email | Post-MVP | 1 (follow-up) | **Built**. Daily summary at the hour and time zone the member chooses. Weekly digest ([0034](../decisions/0034-notification-types-and-weekly-digest.md)): on Monday at the member's digest hour in their time zone, on by default, at most once in 6 days, one email for every community with at least 2 new posts that week (top posts, new members, next events, course progress, and for the owner the paid members who joined or canceled). The worker checks every 15 minutes. Members turn it off in Account, Notifications or with the one click link in the email |
| Creator feedback questions (Cloud) | One question after a first post, first paid member, and first course, and an optional reason on archive, delete, disconnect Stripe, and delete account | Post-MVP | 1 (follow-up) | **Built** on the Cloud Edition only ([0049](../decisions/0049-creator-feedback.md)). A 1 to 5 ease score with an optional comment, at most one question per creator in 30 days, each moment once per community, off with "Don't ask me again" and back on in Account, Notifications. Answers and reasons are emailed to `CONTACT_EMAIL`, kept for 24 months, and erased with the account. The Community Edition stores and shows nothing |
| Web push | Browser notifications | Post-MVP | 1 (follow-up) | |
| Mobile push | With native apps | Long-term | not scheduled | |

## Migration

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Migration section | Settings section explaining options | MVP | 3 | **Built** (since 0.4.0, moved to its own Manage section in 0.9.0 by founder decision). Manage, Migration, owner only: Import from another platform (Skool, Circle) first, members CSV import, Import history with a CSV report per import, the Bring your existing subscribers card that opens the linking page (Community Edition) or the moving list (Cloud), then export and import of Cohory archives (admins see the section with the subscribers card only). Since r39 exports are deleted after 30 days or by the owner, previews after 7 days or when discarded, progress names the step and count, and the public `/importers` page lists every way to move in |
| Full archive export | JSON plus media with manifest | Post-MVP | 5 | **Built** (since 0.4.0). Format 1.0.0 in architecture/archive-format.md, worker job `migration.export`, download from Migration or the command line |
| Archive import | Restore into another instance | Post-MVP | 5 | **Built** (since 0.4.0). Into an empty community, preview first, people linked by confirmed email on the Community Edition; on Cloud everyone but the owner is invited and kept as a placeholder until they accept ([0043](../decisions/0043-import-invitations-and-emails.md)); the owner emails people now, later from Import history, or never, with a note, a preview, a test, and Resend email in People; retry without duplicates, paid subscriptions become free access until the date they paid for, and "Add them to the list" on Bring your existing subscribers gives them free time to subscribe again |
| Generic CSV importer | Members, then posts and courses | Post-MVP | 5 | **Partly built** (since 0.4.0): members only (email, name, role), preview per row, invite links by email or add directly on the Community Edition, fair use limits, an optional note in the invitation with preview and test, and a result that names the rows skipped and counts opted out addresses as not sent. On Cloud the preview shows "Ready" for every address that is not a member or banned, never whether it has an account. On the Community Edition, add mode sends an invite link instead to an account whose email is not confirmed. Posts and courses not built |
| Skool importer | Members and content where available | Post-MVP | 5 | **Built** (since 0.4.0, importer 1.0.0, best effort): members CSV plus optional posts and comments JSON from third party tools, categories, sanitized bodies. No payment method access, no classroom. Limits: [operations/importers/skool.md](../operations/importers/skool.md), in the app at `/importers/skool` |
| Circle importer | Members, courses, posts | Post-MVP | 5 | **Built** (since 0.4.0, importer 1.0.0, best effort): members, spaces as categories, posts, and comments from the CSV data export or Admin API JSON. Courses do not transfer (no Circle export has them). Limits: [operations/importers/circle.md](../operations/importers/circle.md), in the app at `/importers/circle` |
| Stripe subscription linking | Match existing subscriptions to members | Post-MVP | 5 | **Built** (since 0.4.0) on the Community Edition, where the creator's own Stripe account already holds the subscriptions. Cloud does not offer it since 0.11.0, because its connected account is always new; paying members move with the flow in [0042](../decisions/0042-moving-paying-members.md) |

## Agent integrations

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Internal service layer | UI calls the same services an API will use | MVP | 1 | **Built**. API-first principle |
| Public REST API v1 | Versioned API with OpenAPI at `/api/openapi.json` | Post-MVP | 6 | **Partly built** (since 0.6.0: routes under `/api/v1` answer to a session or a scoped API token; every operation declares its scope in `x-cohory`; not yet a stable contract) |
| Personal and agent API tokens | Scoped tokens | Post-MVP | 6 | REQ-AGT-002. **Built** (since 0.6.0): personal tokens in Account, API tokens; agent identities and agent tokens in Manage, Settings, Agents; one community per token, shown once, 90 day default expiry, revocation on the next request, effective permission is scope and the owner's current role. Since the review of 2026-10-21: the new token opens in a dialog, pickers offer only permissions the role can use (with presets), "Edit permissions" on agents, last use with time and channel, a notice 7 days before expiry, and Regenerate. Guide: [operations/api-tokens.md](../operations/api-tokens.md) |
| Outbound webhooks | Signed event delivery to other apps | Post-MVP | 6 | **Built** (since 0.6.0, REQ-AGT-007). Owners and admins add up to 20 endpoints in Manage, Settings, Webhooks, choose from `post.created`, `comment.created`, `member.joined`, `member.removed`, `lesson.completed`, `event.rsvp_changed`, `subscription.activated`, and `subscription.ended`, see the signing secret once, send a test event and see its result on the card, read the delivery log, open a delivery with its payload, request, and response per attempt, resend one delivery or every failed one after turning an endpoint back on, edit an endpoint in place, roll the secret with a 24 hour overlap that signs with both secrets, and turn endpoints off. The page lists endpoints first with an Add endpoint button and a "How to verify requests" guide with sample payloads. Standard Webhooks headers and HMAC SHA-256, ids only, retries for just under 3 days, 4 deliveries in flight per endpoint, endpoint turned off with an owner email after a delivery fails every attempt. [operations/webhooks.md](../operations/webhooks.md) |
| Typed SDK | `@cohory/sdk` client generated from OpenAPI | Post-MVP | 6 | **Built** (since 0.6.0) as a workspace package, not published. MIT licensed (ADR 0009, accepted 2026-10-19) |
| MCP server | `/mcp` with scoped tools | Post-MVP | 6 | REQ-AGT-005. First-class, same permissions as API. **Built** (since 0.7.0): Streamable HTTP at `/mcp` with agent and personal tokens, tools generated from REST routes (community, publishing, members, search, events, approvals, payments summary, and since 0.8.0 the course tools, 32 in all), only tools the token and owner role allow are listed, approval answers as `pending_approval` results, member content wrapped as untrusted, audited with How set to MCP. OAuth sign in for clients is not built yet |
| OAuth for MCP clients | Assistants connect through a consent screen instead of a copied token | Post-MVP | 6 | **Built** (since 0.7.0): protected resource and authorization server metadata, dynamic client registration, authorization code with PKCE S256, a consent screen that creates or reuses an agent you own, 1 hour access tokens that are agent API tokens, 30 day rotating refresh tokens with reuse detection, revocation, and Connected apps with Disconnect in Account and Manage, Settings, Agents. Since 0.11.0: a Connect an AI assistant card with the MCP address on both Agents pages, a plain language consent screen that reuses the agent of an earlier connection, each connection shown once inside its agent's card, and `list_courses`, `get_course`, and `get_lesson` tools; members still connect by token only. Guide: [operations/mcp.md](../operations/mcp.md#signing-in-with-oauth). Client ID Metadata Documents are not supported yet |
| Audit log for agent actions | Who, what, when, approved by | Post-MVP | 6 | **Built** (since 0.6.0): every token and agent write records actor type, via, token, agent, and owning human, with Who and How filters and CSV columns; approval requests, decisions, and executions are entries with the agent and the owning human, and the approved action names the approver and the agent. Since the 2026-10-21 review the screen reads as sentences: plain action labels ("Request approved"), the deciding person shown as "Olive approved a request from Helper" with the agent as the subject, people linked to their member page and requests to Inbox history, a Details drawer instead of cut text, and Agent and Token filters (REST: `agentId` and `tokenId`). Every member can open Account, Agents, Activity for their own agents and API tokens in one community (changes only, reads are not recorded) |
| Human approval workflow | Agent drafts wait for approval | Post-MVP | 6 | REQ-AGT-006. **Built** (since 0.6.0): agent posts wait as drafts for a person to publish; with `proposals:write`, money, role, removal, deletion, publishing, settings, export, and webhook actions by an agent become approval requests (202) that owners and admins approve or reject in Manage, Approvals; approval runs the recorded request once as the approver after a recent sign in; 72 hour expiry, 20 pending per agent, notifications to the agent's owner and to owners and admins. An agent can only ask for routes whose scope it holds (plus session only operations). Connecting Stripe through a request is not supported yet, and "Email to all members" does not exist yet; two factor authentication for approvals does not exist yet. Each request carries a category chip (Money, People, Delete, Publish, Data, Settings); money, role, removal, and deletion requests get a red Approve with a confirm, and every request lists the agent's last 3 actions. Deciding marks the decider's alert read, and Account, Agents and Manage, Settings, Agents ask unconfirmed addresses to confirm so approval emails arrive |
| Plugin SDK | `definePlugin` with hooks | Long-term | not scheduled | Founder example in notes |
| AI course generation | Turn documents into a course | Long-term | 7 | |
| Hosted agent execution | Run agents on the platform | Long-term | not scheduled | Deferred in brief |

## Appearance

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Accent color | Custom color with contrast check | MVP | 1 | **Built**. Rejects colors failing WCAG AA on buttons |
| Logo and cover image | Uploads | MVP | 1 | **Built**. The cover shows only on the About hero and "Your communities" cards at 4:1, and on link previews of a public community |
| Font | 3 curated options | MVP | 1 | **Built**. See [../brand/design-tokens.md](../brand/design-tokens.md) |
| Card style | Soft or Minimal | MVP | 1 | **Built** |
| Appearance mode | Light, Dark, System | MVP | 1 | **Partly built** (community default only: Light or Dark applies to the whole page, System follows each visitor's device; platform pages follow the device). Member preference overrides community default |
| Custom CSS | Arbitrary styles | Long-term | not scheduled | Conflicts with consistent layout |
| Themes | Packaged themes | Long-term | not scheduled | WordPress-style direction |

## Admin

| Feature | Description | Phase | Roadmap phase | Notes |
|---|---|---|---|---|
| Manage, Overview | Setup checklist, Needs you, money, and community health | MVP | 1, 3 | **Built** (live 10 step setup checklist, Needs you queue counts, money against last month, health without staff). The owner also sees the feed relevant steps above the feed ("Get your community ready") |
| Manage, People | Members table and requests | MVP | 1 | **Built** (the members table; since the review of 2026-10-21 requests and reports moved to Manage, Inbox) |
| Manage, Payments | Stripe, pricing, payments | MVP | 3 | **Built** |
| Manage, Appearance | Customization with preview | MVP | 1 | **Built** |
| Manage, Settings | General, access, gamification, domain, export, Migration, danger zone | MVP | 1, 4 | **Partly built** (one view per section since 0.11.0: General with the members CSV download for the owner, Joining, Categories, Points, Agents, Webhooks, Audit log, and Danger zone with transfer, archive, and delete; no domain section). Migration was a card here up to 0.8.0 and is now its own Manage section |
| Admin audit log | Role changes, bans, exports, payment settings | MVP | 1 | **Built**. Manage, Settings, Audit log for admins and the owner: who, what, target, and details, filtered by action and date, 50 per page. Only the owner can download it as CSV, and each download is recorded |
| Moderation queue | Reported posts and comments | MVP | 1 | **Built** inside Inbox, Reports (People, Reports before the review of 2026-10-21) for moderators, admins, and the owner: open reports grouped per post or comment with the text, the number of reports, reasons, and notes; Dismiss, Delete, or Ban the author (Ban is offered only when the viewer's role may ban that author); Resolved shows who acted and when. Reporters get an in app notification of the outcome ("A moderator acted on the post you reported" or "reviewed it and left it up"); its email is off by default and can be turned on in Account, Notifications |
| Instance admin (self-hosted) | Operator settings: email, storage, signups | MVP | 4 | **Partly built** (environment variables only, no admin page). Environment variables plus a small admin page |
| Cloud resource limits | Storage and member limits per community | MVP | 4 | Built in 0.2.0: members, storage, and upload size enforced, `FAIR_USE_*` overrides, Usage card in Manage, Overview (see [../self-hosting.md](../self-hosting.md#fair-use-limits)). Numbers are the business model Recommendation |
| Advanced analytics | Retention, cohorts, engagement charts | Long-term | not scheduled | Deferred in brief |
| Automation builder | Rules and workflows | Long-term | not scheduled | Deferred in brief |

## Deliberately excluded

These are excluded on purpose, not forgotten. Each would add complexity to the member experience or to operations before the core is proven.

- **No algorithmic feed in MVP.** The feed is chronological by default (latest activity or new). The optional Top sort orders the last 7 days by a visible count of likes and comments and never hides posts; there is no personalized ranking.
- **No ads.** Not in any edition. The business model is the 2% Cloud fee.
- **No marketplace or community directory in MVP.** Members arrive by the creator's link. A directory invites spam and moderation work.
- **No plugin marketplace in MVP.** The plugin SDK is long-term.
- **No direct messaging in MVP.** Founder priority "Later". Abuse and moderation load.
- **No native mobile apps in MVP.** Responsive web with bottom navigation.
- **No video hosting in MVP.** Embeds from allowlisted providers only.
- **No quizzes, certificates, or drip in MVP.**
- **No multiple tiers, one-time purchases, trials, or coupons in MVP.**
- **No custom CSS or layout changes.** Layout is consistent across communities.
- **No advanced analytics, automation builders, AI course generation, hosted agent execution, or agent marketplace in MVP.** Deferred in the brief.
- **No gamified points for posting volume.** Points come from likes received and, when the creator turns them on, from finished lessons and attended events.
- **No fifth member tab, ever.** Confirmed navigation rule.

## Decisions and open questions

Confirmed:
- Founder priority table and its Essential items are MVP.
- MVP includes the items listed in the brief. Deferred items stay out.

Recommendation:
- MVP equals roadmap phases 1 to 4.
- Basic events in MVP with weekly recurrence.
- Single paid plan per community, course access for all members only.
- Points from likes received, plus optional points for finished lessons and attended events ([0045](../decisions/0045-levels-that-unlock-and-learning-points.md)).
- Members CSV export and an informational Migration section in MVP.

Assumption:
- Events land in roadmap phase 2 and gamification in phase 1.

Open question:
- Cloud resource limits per community.
- Platform fee base with taxes (refund and dispute rules are proposed in [../foundation/business-model.md](../foundation/business-model.md)).
- When the public REST API becomes stable.
