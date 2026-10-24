# 0036. An About page that sells: join in reach, structured selling blocks, and one editor

The About page keeps the join action in reach after the hero (a bar on phones, a card on wide screens, a closing block at the end) and gains three optional blocks that every community gets without writing free text: What you get, About the host, and Questions. Owners edit all of the page text in one form in Manage, Appearance.

- ADR status: Accepted (private community sharing superseded by [0041](0041-private-community-link-previews.md))
- Date: 2026-10-22
- Deciders: founder (approved every item of About page review 11, including the sticky join bar and card, the closing call to action, and What you get), coordinator as product owner for the details
- Supersedes: the parts of [0026](0026-community-page-for-non-members.md) listed under Decision
- Related: [../product/information-architecture.md](../product/information-architecture.md), [0025](0025-reviews-module-boundary.md), [0033](0033-platform-config-and-neutral-home.md)

## Context

The About page review (2026-10-21) found that after the hero scrolled away a visitor had no way to join without scrolling back up 2,000 pixels or more, that the right third of the page was empty on desktop, and that a reader who reached the end hit a dead end. Everything that sold depended on one free text description, and the Membership page showed the same generic list for every community. The share title read only "About".

[0026](0026-community-page-for-non-members.md) (H2, H3) chose one join button in the hero and an About section of gallery, description, and reviews only. The founder approved the review's items, which change both.

The manage review found the About page edited in two sections with three Save buttons, and the Appearance page leading with the accent color while its preview showed a letter even when a logo was uploaded.

## Decision

1. **Join in reach (supersedes 0026 H2 "one join button").** The hero button stays. When the visitor's state can act (Join, Join for a price, Request to join, Join again), the About page adds:
   - below 1024 pixels, a bar fixed to the bottom of the screen with the community name, "{price}/month · Cancel anytime" for a paid community, and the same join control. It shows only while neither the hero button nor the closing block is on screen, and on a public community it sits above the bottom tab bar;
   - from 1024 pixels, two columns: the page on the left and a sticky card on the right with the name, the monthly price, the yearly price and cancel line, the first 3 What you get lines, the join control, and "Taxes may apply.";
   - at the end of the page, a closing block: "Join {name}", the price, the join control, and "Cancel anytime from your account.".
   Pending, invite only, declined, banned, and member states repeat nothing.
2. **Price context.** Under a paid hero button: "or {yearly price}/year. Cancel anytime.", or "Cancel anytime." when there is no yearly price. The "more" dialog of the short description ends with the same join control.
3. **Selling blocks (supersedes 0026 H3 "gallery, description, and reviews").** Order: gallery, What you get, detailed description, About the host, reviews, Questions, closing block.
   - What you get: up to 6 lines of up to 80 characters. When the owner writes none, the page shows what can be counted honestly for a visitor: "Posts and discussions with other members", the number of published courses, and the number of upcoming events in the next 30 days, each only when the visitor may read it and it is above zero. The Membership page shows the same lines instead of its generic list.
   - About the host: the owner's profile photo and name, an optional credential line (up to 120 characters), and an optional bio (up to 600). Hidden when both are empty. "By {owner}" in the hero links to it.
   - Questions: up to 8 question and answer pairs as native disclosure elements. The editor suggests four starters: who it is for, time each week, refunds, and how to cancel.
   - The description is capped at a readable line length.
   - "The creator hasn't added more details yet." is removed: the What you get fallback always gives the page content.
4. **Data.** The columns `what_you_get`, `host_bio`, `host_credential`, and `faq` on `communities` (added by an earlier migration) are written only by a new `updateAbout` service operation in Communities, which checks `update` on `appearance`, validates with the shared Zod schemas, stores empty lists as null, and writes the audit action `about.updated`. Reads go through `getAppearance` (Manage) and `getAbout` (visitors), both returning `{ whatYouGet, host, faq }`.
5. **One editor.** Manage, Appearance has, in order, Logo and cover, Accent color (whose preview shows the uploaded logo), Style, then the About page part: Gallery, and one Page text form with Short description, What you get, Detailed description, About the host, and Questions, saved by one Save About page button. Settings, General keeps the name and privacy only.
6. **Sharing.** The About page title is "About {name}" under the instance title template, and its meta description is the short description on one line, cut at 160 characters. The About page shares the cover as its link preview image for private communities too, because the page shows it to anyone; other routes of a private community still share no image.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| A monthly or yearly switch in the sticky card | Matches the review's sketch | The signed out join continues to monthly Checkout only, and the interval choice belongs to the payments flow | The card shows both prices as text; the switch stays on the Membership page |
| Keep the bar visible at the end of the page | Simpler observer | It covers the closing block and duplicates its button | Hide the bar while the closing block is on screen |
| Store What you get, host, and FAQ inside the `appearance` JSON | No new service operation | Mixes sales copy with theme tokens and the appearance audit | Separate columns already existed from an earlier migration |
| Prefill What you get by writing default lines into the database | Owners see them in the editor | Counts go stale and look written by the owner | Compute the fallback on each render and leave the field empty |
| A side by side live preview in the editor | Immediate feedback | A second renderer of the About page to keep in sync | View About page opens the real page with the preview banner |

## Consequences

- Positive: the join action stays one tap away on every screen size, every community gets a checklist and a closing call to action without writing copy, and one form saves the page text.
- Negative: an About page can show up to four join controls in the DOM (hero, card, closing, bar); only one or two are visible at a time, and tests must scope their queries. A visitor page makes up to two extra reads (course count, upcoming events) when the owner wrote no What you get lines.
- Follow ups: the API and MCP do not expose the About fields yet; the reviews switch and the community name stay in Settings; the yearly choice in the card waits for the payments flow to accept an interval on the signed out join.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Sticky join bar and card, closing call to action, and What you get (founder, H2 and H3 of review 11). |
| Recommendation | The 30 day window for upcoming events, the order of the blocks, and sharing the cover of a private community on the About page only. |
| Open question | Whether the side by side preview the manage review asked for is still wanted once owners use View About page. |
