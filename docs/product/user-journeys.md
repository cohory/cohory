# User journeys

End-to-end journeys for creators, members, and agents, with the screens they touch and what the system does at each step.

Status: Draft, 2026-10-19

Screens and paths match [information-architecture.md](information-architecture.md). Scope boundaries match [mvp-scope.md](mvp-scope.md). Payment behavior follows [../architecture/payments.md](../architecture/payments.md) and permissions follow [../architecture/authorization.md](../architecture/authorization.md). Phases refer to [../foundation/roadmap.md](../foundation/roadmap.md).

Each journey lists actor, preconditions, steps (screen, then action, then system behavior), success criteria, failure and edge cases, and phase. Journeys marked Post-MVP describe planned behavior, not shipped behavior.

## Journey index

| # | Journey | Actor | Phase |
|---|---|---|---|
| 1 | Create a community | Creator | MVP |
| 2 | Connect Stripe and set a paid membership | Creator | MVP |
| 3 | Discover and join a free community | Member | MVP |
| 4 | Buy a paid membership | Member | MVP |
| 5 | Post and comment | Member | MVP |
| 6 | Resume a course from the community home | Member | MVP |
| 7 | Create a course and a lesson | Creator | MVP |
| 8 | Schedule an event and members join | Creator, members | MVP |
| 9 | Earn points and climb the leaderboard | Member | MVP |
| 10 | Cancel a membership or recover from a failed payment | Member, creator | MVP |
| 11 | Export community data | Creator | MVP (members CSV), Post-MVP (full archive) |
| 12 | Move from Cloud to self-hosted | Creator | Post-MVP |
| 13 | Bring existing Stripe subscribers | Creator | Post-MVP |
| 14 | Agent drafts an announcement for creator approval | Agent, creator | Post-MVP |
| 15 | Member gets notification emails and changes them | Member | MVP |
| 16 | Member deletes their account | Member | MVP |
| 17 | Creator sets up the About page | Creator | Post-MVP (Step 17) |
| 18 | Owner changes the community URL | Owner | Post-MVP (Step 18 follow up) |

## 1. Creator creates a community

- **Actor:** creator (new or existing account).
- **Preconditions:** none. Cloud signup is open, or the self-hosted operator allows community creation.
- **Phase:** MVP.

Steps:

1. **Sign up** (`/sign-up`). From the signed out home page, Create your community opens `/sign-up?next=/communities/new`, which says "Create your account, then name your community." and goes to the create form after sign up. Creator enters email and password. System creates the account and sends a verification email. When the server sends email ([0038](../decisions/0038-email-verification-required.md)), the form shows "Check your email" ("We sent a link to {email} to confirm it. Open it within 1 hour"), and the creator confirms the email before the first sign in; the link opens `/verified`, which says "Email confirmed" and offers Sign in back to the create form. A sign in before that says "Confirm your email first" with "Send a new link". Without a mail server (`EMAIL_DRIVER=log`) the form signs the creator in with the password just entered. Sign up answers the same whether or not the address already has an account; when it does, the form shows "Check your email" and the owner of the address gets an email that someone tried to sign up, with Sign in as the main link and "Forgot your password?" second. The verification link never signs anyone in. Connecting a payment account needs a confirmed email when the server sends email.
2. **Create Community** (`/communities/new`), step 1. Creator types a name. System proposes a slug from the name, checks availability 300 ms after typing stops, and shows the full address (`{APP_URL host}/c/{slug}`). As built, a taken or reserved URL shows three free options to pick from.
3. Step 2. Creator picks "Free" or "Paid". Paid communities start as "Free until payments are set up" so the creator is never blocked (Recommendation). As built, the choice is asked on the same form and not stored: Paid creates the community as free and lands the creator on Manage, Payments instead of the feed, with the Payment account card highlighted.
4. Step 3 (optional). Creator uploads a logo and picks an accent color, or presses "Skip". System validates image type and size and stores it in S3-compatible storage.
5. System creates the community with defaults: private, join by approval off (open join for free, checkout for paid), three categories ("General", "Introductions", and admin-only "Announcements"), four tabs, level names from the default ladder, owner role for the creator.
6. **Feed** (`/c/{slug}`). Creator lands on the empty feed with the creator empty state and a suggested introduction post. Above the feed the owner sees "Get your community ready" with the feed relevant setup steps (a pinned welcome post, logo and cover, About page, sharing the link with "Copy community link", and Stripe once payments are started), "Hide checklist", and "All setup steps"; it disappears when those steps are done or hidden. The full setup checklist appears at the top of Manage, Overview, ticked from real data: import first or start fresh, logo and cover, About page, (paid) price and Stripe, a pinned welcome post, a first course or call, preview the About page, share the link, and (paid) a test purchase before going live.

7. On the Cloud Edition, after the first published post the owner sees a small card on the next visit to the feed or Manage: "How easy was it to publish your first post?" with 1 (Very hard) to 5 (Very easy), an optional "What would have made it easier?", Send, Not now, a close button, and "Don't ask me again". The same card follows the first paid member and the first published course, at most one question in 30 days ([0049](../decisions/0049-creator-feedback.md)).

Success criteria: a working community with a reachable URL in under two minutes and no required setting beyond name and slug.

On the Cloud beta (`COMMUNITY_CREATION=operators`), only the design partners in `OPERATOR_EMAILS` take this journey. Other creators press Request early access on the landing or pricing page, answer the three questions at `/early-access`, and wait for the founder's email; a creator who already signed up as a member finds the same link on the home page and in the avatar menu.

Failure and edge cases:
- Slug taken or reserved: inline message and three suggestions.
- Image too large or wrong type: inline message, creator can skip.
- Creator abandons the wizard after step 1: no community is created (Recommendation, avoids empty tenants).
- Cloud abuse controls: rate limit on community creation per account (Recommendation: 3 per day).

## 2. Creator connects Stripe and sets a paid membership

- **Actor:** owner.
- **Preconditions:** community exists, owner email verified.
- **Phase:** MVP.

Steps:

1. **Manage, Payments** (`/c/{slug}/manage/payments`). Primary action: "Connect your Stripe account". Text explains: payments go to your own Stripe account, members' subscriptions live in your Stripe account, Cloud adds "Platform fee: 2%" on successful payments, Stripe processing fees are separate. Self-hosted shows no platform fee.
2. Creator picks the "Country of your business" (preselected from the browser language when Stripe supports that country; Connect stays off until a country is chosen) and presses the button. System starts Stripe Connect onboarding (Cloud) and redirects to Stripe. Creator completes or links an existing Stripe account.
3. Stripe redirects back. System stores the connected account ID, reads account capabilities, and shows status: "Connected" or "Stripe needs more information" with "Finish Stripe setup". A test mode account shows "No real money moves in test mode" with the test card to try the flow as a member.
4. **Pricing card.** Creator sets a monthly price and currency. Optional: "Add an annual price". The monthly price shows the lowest price Stripe accepts for the currency ("At least 0.50 USD."), and a lower price is refused with the minimum (for example "Set a price of at least 0.50 USD."). A line under the price says what the member pays, the platform fee, and that the Stripe fee varies. Before Stripe is ready the card is already there and its button is "Save draft": the draft price is kept but nothing is on sale and members and visitors see no price.
5. Creator presses "Put on sale" (or "Save pricing" for a plan already on sale) once Stripe is ready. System creates the product and prices on the connected account, and the About page now shows "Join for {price}/month". A community set to Approval switches to Open, because payment is the approval ([ADR 0037](../decisions/0037-paid-join-rules.md)); Invite only stays.
6. Existing free members (if any) keep access. System asks once: "Keep current members free?" with "Yes, keep them" as default (Recommendation).

Success criteria: the About page shows a working paid Join button. A test checkout in Stripe test mode creates a subscription on the connected account with a 2% application fee (Cloud) or no fee (self-hosted).

Failure and edge cases:
- Onboarding incomplete or charges disabled: the price can be saved as a draft but not put on sale, and a banner explains what Stripe needs. "Discard draft" removes it. The connected account is created in the chosen country; the hosted onboarding collects the rest.
- Unsupported country or currency for Connect: plain message, link to Stripe requirements. BYO payment provider is Post-MVP.
- Owner disconnects Stripe later (since Step 18): "Disconnect Stripe" on Manage, Payments opens a dialog that counts paying members and offers "Take my members with me" (default) or "Wind down", with an optional Stripe customer portal link for the member email. The connection shows "Disconnecting" and new memberships pause while Cloud removes the platform fee from every subscription and checks it; only then does it apply the choice (wind down sets every subscription to end at its period end), archive the pricing, and close the connection. Members get an in-app notice and an email: "Your membership is now billed directly by {community}. To change or cancel it, use the link in your Stripe receipt emails or contact {owner email}." or that the subscription ends on a date. Paid access in the community ends at each member's stored period end; afterwards the membership page says "Your paid access to {community} ended. Join again from the community page, or contact {owner email}." If Stripe refuses the change for some subscriptions, the page names those members with "Try again" and "Disconnect anyway", which closes the connection and emails the owner how to remove the fee in the Stripe Dashboard. A platform fee received after the owner left is refunded. When the creator revokes access from the Stripe Dashboard (`account.application.deauthorized`), the connection closes, members are told the creator bills them directly, and the owner is told to clear the fee. Connecting again creates a new connected account.
- Owner archives a paid community (since Step 18): the archive dialog in Manage, Settings, Danger zone says how many paying members there are and asks what happens to them. Stop at period end (default) sets every subscription to end at its period end; Keep billing leaves them running and members can cancel from their membership page. Subscriptions linked from before Cohory follow the choice unless the owner leaves them running. Each paying member gets an in-app notice and an email that says what happens and when. New checkouts and plan changes stop until the community is restored. A subscription that Stripe refuses to change is retried; after the eighth attempt the run fails and the owner can try again. Restoring does not turn renewal back on; the restore dialog says how many subscriptions are set to end and that renewal is turned back on in the Stripe Dashboard.
- Owner deletes an archived paid community (since Step 18): the delete dialog in Manage, Settings, Danger zone says "{N} paying members. Their subscriptions are cancelled now and they are not charged again." and offers to leave subscriptions linked from before Cohory running (their Cohory fee is removed). Cohory cancels every subscription at once without proration and checks each one; members keep access until the community is deleted, then get an email that the community has closed and they will not be charged again. While that runs the button reads Deleting…. If Stripe keeps refusing a cancel, nothing is deleted, the community stays archived, and the danger zone says "We could not cancel {N} subscriptions. Try again or cancel them in your Stripe Dashboard." with Try again. When Stripe is already disconnected, the owner must tick "I cancelled these subscriptions in my Stripe Dashboard" next to the last known count. Deletion waits while a Cohory invoice is unpaid; payment records and invoices are kept with the community name.
- Owner transfers a paid community (since Step 18): the transfer dialog in Manage, Settings, Danger zone says Stripe stays connected and new checkouts pause until the new owner keeps it or connects their own. Both people get an in-app notice. Until the new owner decides, the membership page has no Join button and pricing cannot change. On Manage, Payments the new owner chooses "The previous owner's Stripe account keeps receiving payments" (checkouts resume on the same account with the same fee) or "Connect my own Stripe account", which removes the Cohory fee from the old subscriptions, applies "Keep them billed on the previous owner's account" or Wind down, closes the old connection, and then offers "Connect your Stripe account". Existing subscriptions stay on the previous owner's account; their members are told who bills them and get the previous owner's email as the contact.
- Price change: applies to new members only in MVP (Recommendation). Existing subscriptions keep their price. The form says so, and with paying members a confirm reads "{N} members keep {old price} a month. New members pay {new price} a month." before saving.
- Paid members: the paid members table on Manage, Payments shows each member's plan price and interval, filters by Active, Past due, Canceling, and Ended with a count on each, and links each subscription to the Stripe Dashboard ("Open in Stripe").
- Webhook delivery delays: membership is granted on the checkout success webhook, with a polling fallback on the success page.

## 3. Member discovers and joins a free community

- **Actor:** prospective member (guest).
- **Preconditions:** community exists, is free, creator shared the link.
- **Phase:** MVP.

Steps:

1. Guest opens a shared link (`/c/{slug}` or a post or lesson URL). System sees no membership and redirects `/c/{slug}` to the **About** page (since Step 17c). The hero shows the cover (3:1 on phones, 4:1 from 768px, only when the creator added one), the name, "Public · 10 members", the next event when there is one, "By {owner}", the short description (2 lines on phones, 3 from 768px, with "more"), and "Join community" (full width on phones, on the right from 768px). Below it, a public community shows About, Community, Classroom, Calendar, and Members, with About selected; a private community shows no tabs. The About section holds the gallery (swipe or step through it; a video shows its poster and plays only after a click), the detailed description, the courses with their lesson counts, and reviews once there is one. The feed (`/c/{slug}/feed`) and Calendar are readable; Classroom and Members show a lock and a join prompt with a count and the same button, and Classroom lists the course titles with their lesson counts.
2. Guest presses "Join community". Signed in, they join at once. Signed out (since Step 17c), the system remembers the intent for one hour and opens **Create your account** with the community's logo and name and the next step ("Create your account to join {community}.", "Create your account, then ask to join {community}.", or for a paid join "Create your account, then pay $10.00/month with Stripe to join {community}. Cancel anytime."), with a Sign in link for existing accounts that keeps the same return path. After the account is created or the person signs in, the system finishes the join without another press and lands on the **Feed**. The return path is `/c/{slug}/join?intent=join`; only same origin paths are accepted, and the continuation does nothing unless the Join button started it, so a link from another site cannot make someone join.
3. Approval required: the hero shows "Request to join". With join questions it opens a dialog with up to 3 questions (each can be required) and "Send request"; without questions it sends the request at once. A signed out visitor goes through sign up first and comes back to the open questions dialog (`/c/{slug}/about?join=request`), or straight to "Request pending" when there are no questions. Invite only: the hero says "Invite only" and shows no button.
4. Open join: the membership is active immediately. Approval required: the system stores a pending request with the answers and the About page shows "Request pending". Moderators, admins, and the owner see the request with its answers in Manage, Inbox, Requests and approve or decline it, optionally with a note. Approval makes the membership active (fair use member limits apply); a decline shows "Your request was not approved" and the note on the About page, and the person may ask again. Invite links skip approval unless the link was created with "needs approval", in which case redeeming it creates a pending request. The invite page (`/join/{token}`) shows the community's cover, logo, member count, Free or the price, "By {owner}", and the short description. Signed out, "Create account and join" leads and "I already have an account" follows; either remembers the invite on this browser for one hour, and after sign up or sign in the page (`/join/{token}?accept=1`) accepts the invite without another press. Signed in, "Join community" accepts it. A shared invite link to a public community previews as "Join {community} on {instance}" with the cover; for a private community the preview names only the instance.
5. On activation the member lands on the **Feed**. For the first 14 days a "Start here" welcome card sits above the feed with up to four steps that tick themselves from real data: Add a photo and bio, Introduce yourself (opens the composer focused, with the Introductions category chosen), Start the first lesson (only when a published course exists), and RSVP to the next event (only when one is scheduled). "Hide this" dismisses it for this membership, and it disappears once every step is done. Until the member's first post, the composer reads "Write something to introduce yourself" and preselects Introductions. Two minutes after activation (free join, approval, paid checkout, or accepted free access) the worker sends a welcome email, "Welcome to {community}", with the creator's name, links to the feed, the first course, and the next event in the member's time zone, and "Introduce yourself" as the main link. It goes out once per membership in normal operation; a crash during the send can repeat it, so delivery is at least once. Owners and members added by an import with emails off get no welcome email. A member whose email is unconfirmed or who is not entitled when the job runs is skipped and never gets one, even after confirming later.

Success criteria: from link to feed in under one minute for open join.

Failure and edge cases:
- Invite link expired, revoked, or used up: the invite page (`/join/{token}`) stays open, names the community when the link is known, and shows "This invite link has expired or is no longer active. Ask for a new one." instead of a Join button. It does not redirect to the About page.
- Banned person: About page with no Join button and no reason shown.
- Request rejected: the About page shows "Your request was not approved" with the optional note, no reason required. The requester gets a notification for an approved or declined request (`join_request_approved`, `join_request_declined`), and the owner, admins, and moderators get a `join_request` notification (email right away for the owner, in the daily summary for others by default). The team also sees the count next to Inbox in the Manage navigation and on the Requests tab.
- Deep link to a lesson: after joining, the member lands on that lesson, not the feed.
- No platform directory: discovery happens by shared link, search engines (About page only), or custom domain. A community directory is deliberately excluded from MVP.

## 4. Member buys a paid membership

- **Actor:** prospective member (guest).
- **Preconditions:** journey 2 complete.
- **Phase:** MVP.

Steps:

1. The non-member hero shows "Join for {price}/month" and, when the plan has a yearly price, a "Yearly {price}" link next to it, with "Yearly saves {amount}. Cancel anytime." underneath ([0040](../decisions/0040-fair-cancel-and-pause.md), decisions log E-35). Signed in, either one goes straight to Stripe Checkout for that interval. When the community asks join questions, it opens the **Membership** page (`/c/{slug}/membership`) instead, which asks them before checkout; that page has a PricingCard with the price, an interval toggle (if annual exists) that shows "Save {amount} a year" on yearly, what is included, and the same button. The hero hides its own button on the Membership page.
2. Signed out (since Step 17c), the button or the yearly link opens **Create your account** (or Sign in), and after that the system goes straight to Stripe Checkout for the chosen interval without another press (`/c/{slug}/join?intent=checkout` or `intent=checkout_yearly`). If checkout cannot start, the person lands on the Membership page.
3. System creates a Stripe Checkout session on the creator's connected account (direct charge, application fee 2% on Cloud) and redirects to Stripe Checkout. Checkout shows the community logo or cover with the plan and "Cancel anytime from your membership page in {community}." near the pay button. The session expires after 24 hours.
4. Member pays. Stripe redirects to `/c/{slug}/membership?checkout=success`.
5. System receives the checkout and subscription webhooks, creates the subscription record, links it to the member, and grants the community entitlement. The success page polls for the entitlement, then says "You're in", lists the same "Start here" steps as the feed welcome card, and offers "Introduce yourself" as the main button (it opens the feed with the composer focused) and "Go to the community" as a link.
6. Receipt email comes from Stripe (creator's account branding). Two minutes after activation the system sends the welcome email described in journey 3. The owner gets one in-app notice with the price, for example "Sam joined and pays $49.00/month" ([0034](../decisions/0034-notification-types-and-weekly-digest.md)).

Success criteria: paying member reaches the feed without manual steps. Subscription, customer, and payment method exist in the creator's Stripe account.

Failure and edge cases:
- Card declined: member stays in Stripe Checkout with Stripe's message.
- Member closes Checkout: no membership. Stripe returns to `/c/{slug}/membership?checkout=cancel`, which says "Checkout canceled" and shows the PricingCard again.
- Webhook arrives late: success page shows "Finishing setup" and retries for up to 60 seconds, then shows "We'll email you when access is ready". Background job reconciles.
- Duplicate checkout (double click, second tab): every press opens a new Checkout page and expires the member's earlier open one, so only the last page can be paid. If two payments still go through, the system keeps the first subscription, cancels the second at once, refunds it in full, and emails the member "We refunded your second payment of {amount}".
- Invite link to a paid community: the link does not waive the price (confirmed by the founder, 2026-10-19). After sign in the person lands on the Membership page with the PricingCard (since 0.1.0). The invite dialog tells the owner "People with this link still pay to join." In an Invite only paid community, people without an invite see "Invite only" on the About and Membership pages and no price button, and checkout refuses them (`invite_required`); redeeming an invite holds a pending membership that lets that person check out. Someone who paid before (for example after a failed card) can pay again without a new invite.
- Join questions in a paid community: the Membership page asks them under "A few questions before you pay", a required question left empty shows "Answer this question to join.", and the answers are stored with the membership when the payment completes. People who were members or paid before are not asked again when they subscribe again. Free access for selected people is a comp grant (Manage, Payments, Free access). On Cloud the owner sends an offer by email; the person signs in with that confirmed address, opens the Membership page, and presses "Accept free access" before they become a member.
- Taxes: Stripe Tax is the creator's choice in their Stripe account. **Open question:** fee base when tax is collected. See [../architecture/payments.md](../architecture/payments.md).

## 5. Member posts and comments

- **Actor:** member.
- **Preconditions:** active membership. Posting allowed for members (default on).
- **Phase:** MVP.

Steps:

1. **Feed.** Member taps "Write something" (interaction 1). Desktop: the composer expands inline. Mobile: a full-screen sheet opens with the keyboard up.
2. Member types a title and body. Category defaults to the last used one, or "General". Optional: add images, mention with `@`.
3. Member taps "Post" (interaction 2). System saves the post, shows it at the top of the feed, notifies mentioned members.
4. Another member opens the post (**Post details**), writes a comment, presses "Comment". System saves it, notifies the post author, and auto-follows the commenter to the post.
5. The author replies to that comment. Replies are one level deep. System notifies the comment author.

Success criteria: a post in one or two interactions (excluding typing). Comments appear without page reload.

Failure and edge cases:
- Network failure: the composer keeps the text. The title, body, category, and schedule are also saved on this device every few seconds, and the composer offers "Restore draft" or "Discard draft" when the member comes back. The composer says "We couldn't reach the server. Check your connection and try again." Posting, discarding, or signing out removes the saved draft. Leaving the page with typed text asks first.
- Image upload fails: post can be sent without it, failed image is marked.
- Body empty: Post button disabled. Title optional (Recommendation).
- Posting turned off for members by the creator: composer replaced with "Only admins can post here".
- Rate limit: Recommendation of 10 posts per hour per member, to slow spam.
- Deleted post: comments disappear with it. Points from its likes are removed. Members get a not found page. Moderators, admins, and the owner can still open it and see "Deleted by X" with the time, with the content hidden until they choose to show it. Deleted comments appear the same way to them in the thread.

## 6. Member resumes a course from the community home

- **Actor:** member.
- **Preconditions:** member started at least one lesson in a course they can access.
- **Phase:** MVP.

Steps:

1. Member opens the community (`/c/{slug}`). System finds the most recently viewed incomplete lesson.
2. **Feed** shows a "Continue learning" card: course title, lesson title, progress bar, "Continue". Desktop: right column. Mobile: one compact row above the feed.
3. Member taps "Continue". System opens the **Lesson** at `/c/{slug}/classroom/{courseSlug}/{lessonSlug}`.
4. Member watches the video and taps "Mark complete". System records completion, updates the progress bar, and shows "Next lesson". Under the lesson title a line reads, for example, "Lesson 2 of 10, 20% complete". On desktop the lesson list is open from the first paint; on a phone "Show lessons" sits on its own row under the title.
5. After completing the last lesson of the course, a short panel says "You finished {course}" with "Start {next course}" (or "Back to Classroom" when no unfinished course is left), "Share your progress" (the community feed), and the next live call the member is going to, for example "Next live call: Office hours, Tuesday 3 November, 17:00 GMT" (or "See upcoming live calls", the calendar, when there is none).

Success criteria: one tap from the community home to the right lesson.

Failure and edge cases:
- The lesson was deleted or unpublished: card points to the next available lesson in the course.
- Course completed: card disappears. Recommendation: no card if nothing is in progress (no nagging).
- Member lost access (membership ended): card is hidden.
- Video provider unavailable: the lesson body and attachments still load. The embed shows a link to the source.

## 7. Creator creates a course and a lesson

- **Actor:** owner or admin.
- **Preconditions:** community exists.
- **Phase:** MVP.

Steps:

1. **Classroom** (`/c/{slug}/classroom`). Creator presses "New course". A dialog asks for title, short description, and cover image (optional).
2. System creates the course as Draft and opens **Course detail** in edit mode with one empty module "Module 1".
3. Creator presses "Add lesson" in a module. A title row opens in the outline; Enter creates a draft lesson with that title (its link is made from the title) and keeps the row open for the next one, so the whole outline can be sketched first. "Add module" creates one module per press and opens its title for editing. Each lesson row has Edit lesson, Duplicate as draft, Publish lesson or Move to drafts, Move to (another module), and Delete lesson.
4. Creator pastes a video URL (YouTube, Vimeo, Loom, Wistia). System validates it against the allowed providers and shows the embed preview under the field; Save stays off while the link is not supported. Creator writes the body in markdown with a toolbar (heading, bold, list, link, image, code) and a preview that uses the same renderer members see: "Write" and "Preview" on a phone, side by side on wide screens. "Add image", paste, or drop uploads a PNG, JPEG, GIF, or WebP image up to 10 MB (checked again on the server) and inserts it into the body. A heading at the top of the body that repeats the lesson title is not shown twice. Creator attaches files if needed.
5. The lesson editor shows Draft or Published next to its heading. For a draft lesson the creator presses "Publish" (or "Save draft" to keep it hidden); a published lesson has "Save". While a lesson is a draft, saving a new title also updates its link.
6. The course bar shows Draft or Published and "3 of 4 lessons published". Creator presses "Publish course". A dialog says how many lessons will be visible and how many are still drafts, with "Publish draft lessons too" and "Post an announcement in the feed" (off by default). Course becomes visible to members; with the announcement, a "New course" post with a link to the course appears in the feed.
7. Creator reorders lessons and modules by drag and drop or with the keyboard (focus stays on the moved item). System saves order immediately. On a phone, edit mode shows a one line title and puts the outline first.
8. Creator presses "Preview as member" on the course or a lesson. Until "Exit preview" (or the end of the browser session) the Classroom list hides draft courses, and the course and its lessons show only published lessons, without edit controls or agent sections.

Success criteria: a published course with one lesson in under five minutes, created without leaving Classroom.

Failure and edge cases:
- Unsupported video URL: inline message listing supported providers.
- An image link to another site does not show to members: the editor lists it under the body and suggests "Add image".
- Attachment over the size limit: inline message (limit in [mvp-scope.md](mvp-scope.md)).
- Publishing a course when no lesson would be visible: the dialog explains it and Publish is disabled; the service refuses it too.
- Moving a published course to drafts: confirm dialog with the member count. Member progress is kept.
- Deleting a module or lesson: the dialog names it, for example: Delete "Week 1: Foundations"? and says how many lessons go with a module.
- Editing a published lesson: changes are live on save. No version history in MVP.
- Deleting a lesson with member progress: confirm dialog. Progress for that lesson is removed, course percent recalculates.

## 8. Creator schedules an event and members join

- **Actors:** owner or admin, members.
- **Preconditions:** community exists.
- **Phase:** MVP.

Steps:

1. **Calendar** (`/c/{slug}/calendar`). On a wide screen the default view starts with a "Next event" card above the month; phones start with the list. A "Past events" list under it shows the last 60 days (up to 10), with "Watch recording" when the creator added a recording link. Creator presses "New event". Form: title, date, start time, time zone, duration, location (meeting URL or address). Time zone defaults to the creator's browser zone and is a search field: common zones come first as "New York (UTC−4)", typing a city, country, or abbreviation filters the list, and Enter picks the first match. Old zone names (Asia/Calcutta, Europe/Kiev) are shown under their current names. A line under the time fields says when the event happens, with the creator's own time when it differs ("Every Tuesday, 17:00 EDT (Wednesday 00:00 for you)").
2. "More options": description, cover image ("Add cover", an image up to 10 MB), repeat weekly (Recommendation: weekly recurrence only in MVP), end date for the series.
3. "Tell members about this event" is on by default. Creator presses "Create event". System stores the event with its time zone and generates occurrences for the next 26 weeks. A toast says "Event created." with "Copy link". When the switch was on, every active member except the creator gets a "New event" notice in the app, and an email when they turned on email for Event reminders. The form keeps a draft on the device while the creator types and offers "Restore changes" after a reload; leaving with unsaved changes asks first.
4. Member sees the event on the Feed's upcoming event card and in Calendar list view, in their own time zone, with up to 5 faces of members going (members only). Member opens **Event details**, which shows the cover, "Every Tuesday" for a series, and the faces, and taps "Going". System records the RSVP and emails a confirmation with a calendar invite (.ics, METHOD:REQUEST, one calendar entry per date) to members whose Event reminders email is on; the confirmation follows that setting and has no switch of its own. Changing the answer to "Not going" sends "Not going: {title}" with a METHOD:CANCEL for the same entry.
5. One hour before start, system sends RSVP'd members a "Starts in 1 hour" notice in the app and an email (subject "[Community] Starts in 1 hour: {title}") that shows the time in the member's own zone first, with "Join the call" and "Event details" links, a footer to change the setting, and one click unsubscribe. Event reminders email is "immediate" by default. Only members who still have access get the reminder and the notice: a past due member in the payment grace period still does, a member whose paid access ended does not (the member keeps the RSVP and gets the reminder again if access returns within the window). Fifteen minutes before start, Event details changes the primary action to "Join event".
6. Member taps "Join event". System opens the meeting URL in a new tab.

Success criteria: event visible to all members with correct local time. RSVP'd members get a reminder.

Failure and edge cases:
- Daylight saving change in a weekly series: occurrences keep the wall-clock time in the event's time zone.
- Creator cancels one occurrence: for a weekly event, "Cancel or delete" asks "Cancel {date} or delete the series?" with "Keep event", "Cancel this date", and "Delete series". "Delete series" asks again and says what goes away ("12 RSVPs on 6 upcoming dates will be removed."). A canceled date shows "Canceled" and keeps its RSVPs. Members going get "Canceled: {title}" with a METHOD:CANCEL that removes the date from their calendar, and a restored date sends them the invite again. Deleting the event sends the same cancellation for every upcoming date they were going to.
- Creator changes the time zone of an existing event: the form asks whether to keep the clock time in the new zone or keep the same moment (which changes the clock time).
- Creator changes the date, start time, or time zone: occurrences that have ended stay as they were; the others take the new schedule's dates in order, starting with the new date nearest the next occurrence that is not before today (or at the new start when that is later), so each keeps its link, its RSVPs, and its canceled flag, and today's date stays today even when its new time has passed. Extra old dates are removed (a shorter end date, or a series that becomes a single event) and extra new dates added. Before saving, the form says "3 people are going. We'll email them the new time." and, when dates go away, "2 people are going to dates that will be removed. We'll tell them." About a minute after the save (one email for a burst of edits, none when the burst ends where it started), the worker emails people going to a moved date (except the creator who edits) the old and new time with a link to the updated .ics file and, when the server sends calendar invites, an updated invite for the same calendar entry (one email per date then, and a cancellation for each removed date), sends the one hour reminder again for the new time, and tells people going to a removed date that it is removed. Edit always changes the whole series; "this date only" edits, event capacity, and waitlists are not built ([backlog.md](backlog.md)).
- Calendar invites: every invite and cancellation for a date uses the same UID, and SEQUENCE is the number of seconds since 2024 at the moment the job read the state it describes, so a later message always replaces an earlier one in the member's calendar. Calendar emails are delivered at least once: a job that fails after sending is retried and can send the same email again.
- Saving fails (offline, timeout): the form stays filled and says "We couldn't save your changes. Check your connection and try again."
- Meeting URL missing: "Join event" hidden, location text shown.
- Members can add the event to their calendar with an .ics file. Two-way calendar sync is Post-MVP.

## 9. Member earns points and climbs the leaderboard

- **Actor:** member.
- **Preconditions:** active membership.
- **Phase:** MVP.

Steps:

1. Member posts or comments (journey 5).
2. Another member likes the post or comment. System adds 1 point to the author for that community, records the point event, and updates level if a threshold is crossed.
3. On level up, system shows a small in-app notification ("You reached Level 3: Regular").
4. **Members, Leaderboard** (`/c/{slug}/members/leaderboard`) shows the level ladder with how many members are at each level, the 7-day ranking, the all-time ranking, and the member's own rank pinned at the bottom if outside the top 10.
5. Member's level shows on their avatar across the community and on their profile.

Success criteria: points and levels update within seconds. Leaderboards are consistent with point events.

Failure and edge cases:
- Self-likes are not allowed.
- Unlike removes the point. Deleted content removes its points.
- Members removed from the community disappear from leaderboards. Points return if they rejoin within 90 days (Recommendation).
- Abuse (like rings): admins can reset a member's points. Automated detection is Post-MVP.
- The 7-day leaderboard is a rolling window, recomputed by a background job at least every 15 minutes (Recommendation).

## 10. Member cancels a membership or recovers from a failed payment

- **Actors:** member, owner.
- **Preconditions:** member has an active paid membership.
- **Phase:** MVP.

Steps (cancel):

1. The Membership page (`/c/{slug}/membership`, also "Membership and billing" in the community's "..." menu and Billing in the account menu) says "{plan} membership. {amount} per {interval}. Next payment {date}." with "Manage billing" and a "Cancel membership" link. **Account, Billing** (`/account/billing`, since Step 18) lists every paid membership with "Manage billing" on each row. When the creator disconnected Stripe, the row says "Billed directly by {community}" with the creator's support contact instead, and the member cancels through the link in their Stripe receipt emails.
2. "Cancel membership" opens `/c/{slug}/membership/cancel` ([0040](../decisions/0040-fair-cancel-and-pause.md)): what the member used so far (lessons finished, events attended, posts written), the price, and "If you cancel, you keep access until {date} and aren't charged again." It asks an optional reason and comment, which go to Stripe with the cancellation. Three choices sit side by side with the same weight: "Switch to yearly and save {amount}" (when a cheaper yearly price exists), "Pause payments" for 1, 2, or 3 months (monthly memberships), and "Cancel membership". Cancel opens the Stripe customer portal on its cancel confirmation and returns to the Membership page. "Keep my membership" goes back. Members can still cancel from "Manage billing" in the portal directly.
3. Stripe sets the subscription to cancel at period end. System receives the webhook and the Membership page shows "Access until {date}". Manage, Payments shows the subscription as "Canceling" with "Ends {date}" in Paid members.
4. Pause: Stripe stops charging (`pause_collection`, invoices voided) until the paid period plus the chosen months. The Membership page says "Payments paused", "Payments start again on {date}" right after pausing, and "You keep access until {date}" with "Resume payments". Access ends when the paid period ends, and resuming restores it. Switch to yearly opens the portal on the yearly price with Stripe's proration before the member confirms.
5. Monthly members see "Switch to yearly: {price} a year, {amount} less than monthly." with a "Switch to yearly" button on the Membership page after two paid months. Yearly members get "[{community}] Your membership renews on {date}" with the amount and a Manage billing button seven days before renewal.
6. At period end, system removes the entitlement. The member becomes a guest and sees the About page with "Join for {price}/month". Manage, Payments shows the subscription as "Canceled" with "Ended {date}" in Paid members. Since 0.1.0, access removal is visible on private communities only, because a public community shows its member tabs to non members.

Steps (failed payment):

1. Stripe renewal fails. Stripe retries according to the creator's Stripe settings.
2. System marks the membership past due and shows a "Payment failed" banner in the community with a "Manage billing" link to the Membership page. The Membership page shows "Payment failed" and a "Manage billing" button that opens the Stripe customer portal. Manage, Payments shows "Past due" in Paid members. Access continues while past due (Recommendation). For each of Stripe's first three attempts, the member gets an email and an in-app notice with the amount and the next retry date that link to the Membership page ([0034](../decisions/0034-notification-types-and-weekly-digest.md)). The owner gets one in-app notice on the first failure. Creators should turn off Stripe's own customer email about failed card payments so members do not get two emails.
3. If Stripe marks the subscription canceled or unpaid, system removes the entitlement and Paid members shows "Canceled" or "Unpaid". A member who sets their subscription to cancel at the period end shows up as a cancellation notice for the owner.

Success criteria: membership state in Cohory always matches subscription state in Stripe after webhook processing.

Failure and edge cases:
- Refunds and disputes are handled in the creator's Stripe dashboard. Neither removes access automatically. When a member disputes a payment, the owner gets a notice and an email that link to Stripe's disputes page. On Cloud, a lost dispute refunds the platform fee on the disputed amount ([0028](../decisions/0028-stripe-disputes.md)).
- Staff remove or ban a paying member ([0029](../decisions/0029-remove-or-ban-ends-billing.md)): the Remove and Ban dialogs in Manage, People say "{name} pays {amount} per {interval}. Their subscription ends now with no refund." On confirm, the subscription is cancelled at once without proration and no refund is issued. A refund, if the creator wants one, is made in their Stripe dashboard.
- Member leaves a paid community (founder decision R1, 2026-10-21): leaving does not cancel the subscription. The Leave dialog in the "..." menu says so ("Leaving doesn't cancel your paid membership. You'll still be charged until you cancel it, and while it's active you can join again without paying.") and links to Account, Billing, which keeps listing the subscription. In a private community the dialog says they can come back without paying or a new invitation. While paid access lasts (active, past due, or canceling before the period end), the community page shows Join again and the Membership page says "You left {community}" with Join again; pressing it restores the membership without Checkout. After the period end, joining goes to Checkout as for anyone else. A member removed or banned by staff never gets Join again from a subscription, and a subscription renewal does not bring back a member who left or was removed.

## 11. Creator exports data

- **Actor:** owner.
- **Preconditions:** community exists.
- **Phase:** MVP for members CSV. Post-MVP (Phase 5) for the full archive.

Steps (MVP):

1. **Manage, Settings, General.** Owner presses "Download members CSV" in the "Export your data" card.
2. System generates a CSV with one row per member and these columns in this order: `email`, `name`, `username`, `role`, `joined_at`, `level`, `points`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `last_active_at` (the latest post, comment, like, lesson progress, or RSVP in the community, or a sign in anywhere on the platform), `access` (paying_monthly, paying_yearly, free_access, past_due, cancelling, or none), `signed_in` (yes when the person ever signed in, confirmed their email, or has a password or social login; no for imported members who have not). The file is UTF-8 with a byte order mark, cells that start with `=`, `+`, `-`, `@`, or a tab are prefixed with `'` so spreadsheets do not run them, and the file is named `{slug}-members-YYYY-MM-DD.csv`.
3. Download starts. System records the export in the audit log.

Steps (Post-MVP full archive):

1. **Manage, Settings, Data export.** Owner presses "Export everything".
2. System queues a background job that writes a documented archive: JSON files for members, posts, comments, courses, modules, lessons, events, and point events, plus media files and a manifest with schema version.
3. System emails the owner a signed download link valid for 7 days (Recommendation).

Success criteria: the export opens in common tools (spreadsheet for CSV, any JSON reader for the archive) and the format is documented.

Failure and edge cases:
- Large communities: export runs as a job with progress, never in the request.
- Admins cannot export member emails (Recommendation, owner only).
- Export contains personal data: confirm dialog reminds the owner of their privacy obligations.

## 12. Creator moves from Cloud to self-hosted

- **Actor:** owner, with someone able to run Docker Compose.
- **Preconditions:** the community exists on Cloud. Community uses Stripe Connect on Cloud.
- **Phase:** Post-MVP (Phase 5). Steps 1 to 7 are built (since 0.4.0); the two stack run (Cloud to Community Edition) was verified for 0.4.0. The full guide is [../operations/offboarding.md](../operations/offboarding.md).

This journey has two separate parts. Moving data is under Cohory's control. Continuing payment collection depends on Stripe account types and capabilities and is not guaranteed for every account.

Steps:

1. On Cloud, owner opens **Manage, Migration**, presses Start export under Cohory archives, and downloads the archive ([../architecture/archive-format.md](../architecture/archive-format.md)) when the card shows it is done. The zip also holds a README and spreadsheets of members, posts, and comments. The export is kept for 30 days, and the owner can delete it sooner.
2. Owner installs the Community Edition with Docker Compose on their server and signs up with the same email.
3. On the self-hosted instance, owner creates an empty community, opens Manage, Migration, Import archive, and uploads the zip. System checks the archive and shows a preview: counts, how many people already have an account and are linked by email, how many get a new account, and warnings. Only accounts with a confirmed email are linked; other people who already have an account become unlinked placeholders that hold their content, and can be emailed an invite link to join with their own account. When the import runs on Cloud instead, every person except the owner becomes such a placeholder and is invited ([../architecture/archive-format.md](../architecture/archive-format.md) rule 3, [0043](../decisions/0043-import-invitations-and-emails.md)).
4. Owner chooses **Email these people?**: Email everyone now, I will send emails later (the default), or Do not email, adds an optional note, can **Preview email** and **Send me a test**, and confirms. New accounts get a direct link to choose a password (7 days) and placeholders get their invitation (30 days). At most 1,000 import emails go out per community per day; the rest follow the next day. System restores members, roles, content, courses, progress, events, RSVPs, points, comped access, invite links, and the audit log, turns active paid subscriptions into free access with the Stripe subscription id in the note, and reports anything skipped. The command line (`migration-cli.js import`) does the same and creates the community when needed.
5. Owner connects the same Stripe account to the self-hosted instance using their own API keys and recreates the plan. On "Bring your existing subscribers", system lists the subscriptions on that account, matches them to members by confirmed email, and links them with no member action ([../operations/payment-migration.md](../operations/payment-migration.md)). The owner ends the free access from the import afterwards.
6. On Cloud, owner disconnects Stripe (Manage, Payments) and keeps "Take my members with me". Cloud removes the application fee from existing subscriptions first, then closes the connection and tells members the creator bills them directly ([../architecture/payments.md](../architecture/payments.md) section 13.8).
7. Owner points the domain at the new server. Members sign in again (sessions do not transfer). Passwords are not exported: members without an account on the new server choose one through Forgot password.

Success criteria: same members, content, and access on the self-hosted instance, no new platform fees on Cloud. The automated round trip test in `packages/migration` exports a seeded community and imports it into a second database with counts, roles, progress, RSVPs, points, entitlements, and files matching.

Failure and edge cases:
- Stripe account type does not allow the self-hosted instance to manage existing subscriptions: data moves, but subscriptions must be recreated and members must re-enter cards. Stated before the owner starts.
- Partial import failure: Try again continues the same job without duplicates.
- The owner wants to know what moved later: Import history on the Migration page lists the import with counts, rows skipped, and emails sent, and Download report gives a CSV.
- The owner chose to send emails later: Import history shows "Emails not sent yet" and **Send the emails**, which emails each person once. People shows **Resend email** for one person who has not set a password or accepted yet.
- An address opted out of email or bounced: it is not emailed and the result counts it as not sent.
- Target community not empty: the import is refused before anything changes.

## 13. Creator brings existing Stripe subscribers

- **Actor:** owner or admin moving from another platform.
- **Preconditions:** linking (steps 1 to 6): Community Edition, and the creator's subscribers already live in a Stripe account the creator controls, connected with its own keys on Manage, Payments. Moving with free time (steps 7 to 10): any edition.
- **Phase:** Phase 5. Linking built in 0.4.0, moving with free time built with [0042](../decisions/0042-moving-paying-members.md) (see [payment-migration](../operations/payment-migration.md)).

Cloud does not offer linking, because its connected account is always new: the Manage card says "Members who paid you on another platform start a new subscription here" with "Move paying members", and the page shows only steps 7 to 10.

Steps:

1. **Manage, Migration**, "Bring your existing subscribers" (also linked from Manage, Payments) opens `/c/{slug}/manage/migration/subscribers`. The page states the limits first: no card data moves, members keep paying on the same Stripe subscription, subscriptions another platform created cannot be linked, and after linking members manage billing from their membership page.
2. System lists active, trial, and past due subscriptions on the connected account, 50 per page, with customer email, price, billing period, status, and renewal date.
3. System matches each customer email, case insensitive, to a member with a confirmed email ("Link to member"), to a confirmed account without membership ("Link and add member", Community Edition only), or to nobody or an unconfirmed account ("Invite by email"). On Cloud the screen never shows whether an address outside the community has an account: every address that is not a member shows "Not a member yet" and gets an invite, which the person claims by signing in. Blocked rows (another platform, no email, banned, customer bound to someone else, already linked or invited) can only be skipped. The creator picks whether each subscription counts as a monthly or a yearly membership when the Stripe price does not match the plan.
4. Linked subscriptions carry no platform fee (the Community Edition has none).
5. Owner confirms. System fetches and matches each row again, links subscriptions, grants access, and emails invited people ("Your membership has moved"). No new charge happens. A result summary lists what was linked, invited, skipped, or refused and why.
6. An invited person opens the membership page from the email, signs in or signs up with that email (the page offers both to signed out visitors), and confirms it. Access starts then, with "Your membership has moved".
7. **Paying members to move.** On the same page, "Add them to the list" adds the people the last Skool, Circle, or archive import marked as paying ("3 people who paid on Skool are not on this list yet"), or the creator pastes addresses with their old renewal dates and an optional shared "Free until" date, then "Add to the list".
8. "Email everyone not moved yet" sends each pending person "Keep your membership" ("You won't be charged until {date}. Cancel your old subscription on Skool now.") at most once a week, until a week after their free time ends.
9. The member opens the membership page, signs in or signs up, and sees "Your current subscription ends on {date}" with "Subscribe again". Checkout starts with a free period until that date.
10. When the new subscription starts, the list shows "Moved. Cancel their old subscription"; people whose date passed show "Free time ended".

Success criteria: imported members get access without paying again or re-entering a card. Verified with recorded fakes in `packages/payments/src/linking.integration.test.ts` and against a Stripe sandbox ([payments.md](../architecture/payments.md) section 13.10).

Failure and edge cases:
- Subscriptions owned by the previous platform's Stripe account (not the creator's): cannot be linked. Members subscribe again with free time (steps 7 to 10).
- Email mismatches: the row proposes an invite; the owner can skip it and resolve it by hand.
- A linked subscription set to end: the member's membership page offers "Subscribe again" with a free period until the old one ends.
- Imports without payment method access (for example Skool or Circle): members subscribe again with free time (Option C, steps 7 to 10). Archive imports give paying members free access until the date they paid for.

## 14. Agent drafts an announcement for creator approval

- **Actors:** an agent with its own identity, the owner as approver.
- **Preconditions:** owner created an agent identity with scope "draft posts" in one community. Agent integrations shipped (Phase 6).
- **Phase:** Post-MVP (Phase 6, built in 0.6.0 and 0.7.0).

Steps (as built):

1. Owner tells their assistant: "Draft an announcement for Monday's call". The assistant calls the Cohory MCP server or REST API with the agent's token.
2. System checks the token scope and answers 201 with `status: "draft"`. The draft is stored apart from posts and is not visible to members.
3. Owner or an admin sees the draft under **Drafts waiting for you** in Manage, Settings, Agents, with the Agent badge.
4. They press **Publish draft** or **Discard draft**. The published post keeps the agent and shows the Agent badge; editing before publishing and scheduling from the draft are not built.
5. Audit log shows: agent identity, action, time, approver.

Success criteria: no agent content reaches members without a human approval. The agent cannot do anything outside its scopes.

Failure and edge cases:
- Agent tries to publish directly: the post is saved as a draft anyway. Email to all members is not open to agents.
- Prompt injection in content the agent read: content is untrusted input, approval step is the safeguard.
- Token revoked: further calls fail immediately.

## 15. Member gets notification emails and changes them

- **Actor:** member.
- **Preconditions:** member of at least one community, with the default notification settings and a confirmed email address.
- **Phase:** MVP (built in 0.3.0).

Steps:

1. Another member mentions them in a post. About 3 minutes later the worker sends one email with the post title as the subject ("[Community] {post title}", or "[Community] Name mentioned you in a post" when the post has no title), the sentence "Name mentioned you in a post in {community}.", the first line of the post or comment in quotes, an "Open the post" or "Open the comment" button, the reason for the email, a link to Account, Notifications, and a Stop these emails link. A reply to them on the same post within those minutes joins the same email ("2 updates on {post title}"), and a notification read in the app meanwhile is left out.
2. A member comments on their post. The comment waits for the daily summary, which arrives at 08:00 in their time zone with one line and link per notification, grouped under a heading per community, and a subject that says what happened ("Sam and 2 others commented on your posts").
3. **Account, Notifications.** They switch Comments on your posts to Off by email and set the summary to 18:00, then press "Save changes".
4. They press Stop these emails in a mention email. The `/unsubscribe` page asks "Stop emails about mentions?" and, after "Stop emails about mentions", confirms that email for mentions is off. No sign in is needed.

Success criteria: each notification is emailed at most once, a notification already read in the app is not emailed, and turning a type off in the app hides it from the bell without stopping its email.

Failure and edge cases:
- A forged or edited unsubscribe link, or one older than a year, shows "This link has expired or is not valid" and changes nothing. Links carry the time the email was sent; links from before 0.9 count as sent on 19 October 2026.
- Mail server down: the email is retried on the next run, one minute later.
- Notifications older than a day (right away) or two days (daily summary) are not sent late.
- The member lost access to a paid community between the notification and the email: the email still says what happened but leaves out the quote and the post title.
- A display name that looks like a link, an email address, or a spreadsheet formula is left out of subjects, greetings, and sentences ("Hi," and "Someone"); links and control characters are removed from other names, which are cut at 50 characters.
- Unconfirmed email address (founder decision, 2026-10-19): no notification email or daily summary is sent, and the notifications are recorded as skipped, so confirming later does not send old ones. Account and Account, Notifications show a "Confirm your email" notice with "Send a new link", which sends a fresh confirmation link through Better Auth. Password reset, email confirmation, invitations, payment emails, and platform billing emails still go to unconfirmed addresses.
- Address bounced or marked as spam (since [0035](../decisions/0035-email-suppression-and-delivery-headers.md)): the address is on the suppression list, so notifications, reminders, invitations, and other community email are skipped and logged as suppressed. Password reset, email confirmation, and other security email still arrive. An operator lifts the entry with `pnpm email:suppress remove`.
- An invited person who never joined presses "Don't email me about {community}" in an invitation, "has moved" email, or free access offer. `/email-opt-out` asks "Stop emails about this community?" and, after "Stop these emails", confirms that no more email about that community goes to the address. Email from other communities and security email still arrive.

## 16. Member deletes their account

- **Actor:** member.
- **Preconditions:** signed in.
- **Phase:** MVP (built in 0.3.0).

Steps:

1. **Account, Danger zone.** If they own a community that is not archived, the panel lists it with a link to its Settings and no delete button. They transfer ownership or archive it first. Since Step 18, an archived community that still has active subscriptions or an open Stripe connection also blocks deletion and is listed with a link to its Payments page; the owner ends billing there or deletes the community.
2. They type their email address and press "Delete account". Every session ends and the sign in page says the account is scheduled for deletion.
3. Within 14 days they sign in. Instead of their communities they see "Your account is scheduled for deletion" with "Cancel deletion" and "Sign out". Cancel deletion keeps the account.
4. If they do nothing, the hourly job erases the account after 14 days: name, email, avatar, username, sessions, credentials, memberships (kept as removed rows without bio or join answers), RSVPs, course progress, points totals, notification preferences, and notifications are removed, API tokens and the agents they own are revoked in every community, open paid subscriptions are cancelled, and the Stripe customer is deleted. Posts and comments stay in their communities under the name Former member. Join request answers and the decision note on them are emptied, the notes the person wrote on their reports are removed, and comped access rows for them (with the admin's note) are deleted, in every community including ones they only asked to join; the purge reaches these rows through the `app.account_purge` row level security policies of migration 0025. Reports, point history, invite links they created, and admin audit entries keep the erased account's id, which now points at the anonymized Former member record; the ban list keeps a banned person's email so the ban survives erasure. Webhooks receive `member.removed` with reason `left`.

Success criteria: the account audit log records the request, a cancellation, and the erasure. The email address can be used for a new account after erasure.

Failure and edge cases:
- Ownership received during the grace period holds the erasure until the community is transferred or archived, and, for an archived community, until it no longer bills members or has Stripe connected.
- If Stripe refuses to cancel a subscription or delete the customer, the account waits for the next hourly run.

## 17. Creator sets up the About page

- **Actor:** creator (owner or admin).
- **Preconditions:** the community exists and is not archived.
- **Phase:** Post-MVP (built in Step 17, founder decisions F6 to F10).

Steps:

1. **Manage, Appearance, About page.** In Gallery the creator presses "Upload image" and picks a PNG, JPG, WebP, or GIF up to 10 MB, or pastes a YouTube, Vimeo, or Loom link into "Video link" and presses "Add". Each item gets optional alt text, saved when the field loses focus, and an actions menu with Move up, Move down, Make hero, and Remove. The gallery holds up to 10 items and the first one is the hero.
2. The creator drags items, or uses Move up and Move down, to change the order. One change rewrites every position.
3. In Detailed description the creator writes the full story with **bold**, *italic*, dash lists, links, and video links, and presses "Save description". The short description stays in Manage, Settings, General.
4. A visitor opens `/c/{slug}/about` (or `/c/{slug}` for a private community) and sees the new page; members open it from the community name or logo in the header.

Success criteria: the About page shows the hero and thumbnails in the saved order, the info row, the rendered description, and the join button; gallery images count toward the storage limit.

Failure and edge cases:
- A link from another host, or a Wistia link, is refused with "Paste a YouTube, Vimeo, or Loom video link."
- An 11th item is refused with "The gallery can hold up to 10 items. Remove one to add another."
- An image over the storage limit is refused with the fair use message, and nothing is stored.
- Removing an item deletes its stored image; deleting the community deletes all gallery images.

## 18. Owner changes the community URL

- **Actor:** the owner. Admins see the URL read only; agents and API tokens cannot change it.
- **Preconditions:** the URL has not changed in the last 30 days.
- **Phase:** Post-MVP (founder decision S1, 2026-10-21).

Steps:

1. **Manage, Settings, General, Community URL.** The field shows the app address and `/c/` before the current slug. The owner types the new slug and presses "Change URL".
2. The dialog "Change the URL to {address}?" says links that use the old URL, including shared invite links, keep working and take people to the new one, that the URL can change again after 30 days, and that the old URL stays reserved for this community. The owner presses "Change URL".
3. The page reloads at `/c/{new}/manage/settings`. The field says "You can change it again on {date}." The audit log records `community.slug_changed` with the old and new slug.
4. Anyone who opens an old link (`/c/{old}`, `/c/{old}/about`, a lesson, or `/api/v1/communities/{old}/...`) gets a permanent redirect to the same page under the new slug, with the query string kept.

Success criteria: the new URL works at once, every old URL redirects, invite links and emails keep working, and no other community can take the old slug.

Failure and edge cases:
- A second change within 30 days is refused with "You can change the community URL again on {date}."
- A slug that another community uses now or used before is refused with "That URL is taken or was used by another community before. Try a different one."
- A reserved slug (for example `manage` or `api`) is refused with "That URL is reserved. Try a different one."
- The owner may go back to one of the community's own old slugs after 30 days.

## Decisions and open questions

Confirmed:
- Content is created where it lives. Payments go to the creator's own Stripe account. Cloud platform fee is 2%, self-hosted has none.
- Data export and continuation of payment collection are separate concerns.

Recommendation:
- Paid communities start free until Stripe is connected. Price changes apply to new members only.
- Weekly recurrence only for events, 12 weeks of generated occurrences.
- Points from likes received only. Rolling 7-day leaderboard.
- Access continues while past due. Refunds do not revoke access automatically.
- Members CSV export in MVP. Full archive export in Phase 5.
- Archiving a community (Manage, Settings, Danger zone) makes it read only: members keep reading everything, but new posts, comments, likes, RSVPs, lesson progress, and course or event edits are refused, as are joins, new invite links, and People or Appearance changes. Settings, restore, transfer, delete, and the members CSV keep working.
- Agent drafts always require human approval.

Assumption:
- Creators accept Stripe Checkout and the Stripe customer portal as the payment and billing UI in MVP.

Open question:
- Fee base with taxes. Fee treatment on refunds and disputes is proposed in [../foundation/business-model.md](../foundation/business-model.md) (proportional refund, refund on lost disputes) and awaits sign-off.
- Removing application fees from existing subscriptions when leaving Cloud.
- Password portability between instances.
- Platform fee on imported subscriptions.
