# 0041. A private community shares nothing about itself in link previews

The About page of a private community no longer puts the cover, the short description, or an "About {name}" preview title in its link preview tags. Every route of a private community now follows the same rule.

Status: Accepted, 2026-10-22

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner (review of 2026-10-21)
- Supersedes: the private community part of item 6 (Sharing) in [0036](0036-about-page-that-sells.md)
- Related: [../product/decisions-log.md](../product/decisions-log.md) J4, [../product/information-architecture.md](../product/information-architecture.md)

## Context

Step 18 decided that a private community never exposes its cover in link previews (decisions log J4), and the e2e journey `step18-cover.spec.ts` checks it. Decision 0036 then let the About page of a private community share its cover, because the page shows the cover to anyone who has the link. A release check found the e2e check failing on main for two reasons: the About page shared the cover, and every route of a private community inherited the instance image from the root `opengraph-image` file added with the platform link previews.

A link preview is not the same as a visit. Chat apps, social networks, and crawlers fetch the preview tags whenever the link is pasted anywhere, and they cache and repost the image and text. An owner who picks Private expects the community to stay out of those places.

## Decision

1. Every route of a private community, the About page included, sets the Open Graph and Twitter card title to the instance name and an empty image list, so neither the cover nor the instance image appears and Next does not fill the preview title from the page title. The About page keeps its document title ("About {name}" under the instance name) and sets no meta description.
2. A public community keeps everything 0036 item 6 describes: the short description as meta description, "About {name}" as preview title, and the cover as the Open Graph and large Twitter card image.
3. `aboutShareMetadata` and `communityShareMetadata` in `apps/web/lib/communities/share-metadata.ts` are the only places that build these tags, and each has a unit test for both privacy settings.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Keep sharing the cover on the About page of a private community | Prettier previews for owners who share the link on purpose | Leaks the cover and description wherever the link is pasted, and contradicts J4 | Privacy wins over preview quality |
| A per community switch to allow previews | Owner choice | A new setting for a rare need | Not needed for the MVP |

## Consequences

- Links to a private community show the instance name with no image and no community details.
- An owner who wants a rich preview can make the community public.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Private communities share no cover, description, or community preview title (J4, restored). |
| Open question | Whether owners of private communities want an opt in for rich previews. |
