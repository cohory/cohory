# Visual identity

The look of Cohory: logo direction, color, type, layout, motion, dark mode, creator customization, and accessibility rules.

Status: Draft, 2026-10-19

Exact values live in [design tokens](./design-tokens.md) and [colors.json](../../assets/brand/colors.json). This doc explains the intent behind them. Related: [brand strategy](./brand-strategy.md), [voice and tone](./voice-and-tone.md), [information architecture](../product/information-architecture.md).

## Visual direction

**Recommendation:** "A well-lit room." Light gray floor, white tables, clear signage, one color that tells you where to act. The interface should feel like a calm, tidy place where the creator's content is the most colorful thing on screen.

Rationale:
- **Confirmed:** the founder direction is white and light gray surfaces, generous spacing, subtle borders instead of heavy shadows, rounded cards, clear typography, one accent, and almost no clutter.
- Creators bring their own logo, cover image, and accent. A quiet frame lets very different communities look like themselves without breaking the shared layout.
- Calm visuals support the brand promise of trust: money, access, and data screens should look as steady as the copy reads.

What makes it distinct (not borrowed): warm spacing and large touch targets aimed at non-technical creators, a single accent rather than a multi-color system, cover images framed like a book jacket at the top of each community, and progress shown as quiet line meters rather than badges and confetti. We do not reproduce the layouts, color pairings, or iconography of Skool, Circle, Linear, or Notion.

## Logo direction

**Confirmed** (founder, 2026-10-20): the product name is written "Cohory" with a capital C in the wordmark, the header, UI copy, emails, and page titles. Package names, URLs, CLI commands, environment variables, code identifiers, token prefixes (`cohory_`), and cookie names stay lowercase.

**Confirmed** (founder, 2026-10-20): the interim app icon is the one in `apps/web/app/icon.svg`, a rounded square in the accent color with a ring in the accent foreground color. The platform bar shows it before the wordmark "Cohory" in semibold. Inside a community the platform bar shows the community logo (or its initial on an accent muted tile when there is no logo) and the community name instead, both linking to the community feed.

The concepts below were explored before the name was final. Every concept must work at 16px, in one color, and alongside the wordmark.

1. **Open ring.** A circle drawn with a thick stroke (stroke width one sixth of the diameter, round caps) with a 60 degree opening at the right. It reads as a lowercase "c" and as a door left open: you can join, and you can leave. Risk: circles are common in this category (including a direct competitor called Circle), so the opening angle and stroke weight must be checked against existing marks before adoption.
2. **Three seats.** Three equal filled circles arranged in an equilateral triangle, close enough that the negative space between them forms a small soft triangle. People gathered around a shared center. Works well as a favicon and as a loading mark (the three circles can pulse in sequence, with reduced motion respected).
3. **Wordmark only.** "Cohory" set in the primary typeface at semibold, tracking tightened by 2%, with the counter of the first "o" filled with the accent. No separate symbol. Cheapest to maintain.

**Recommendation:** use the app icon and the wordmark above until final artwork exists. Asset rules are in [assets/brand/README.md](../../assets/brand/README.md).

## Color system

**Confirmed:** one accent color, neutral surfaces. **Recommendation:**

- **Neutrals carry the layout.** Background `#F8FAFC`, cards `#FFFFFF`, text `#111827`, secondary text `#64748B`, borders `#E5E7EB`. Hierarchy comes from spacing, weight, and size before color.
- **One accent** (`#2563EB` by default, replaceable per community) marks primary actions, links, selection, focus, and progress. Never decorative. If everything is blue, nothing is.
- **Semantic colors** exist only for status: success (green), warning (amber), danger (red), info (sky). Each has a solid color, a foreground for text on the solid, and a muted background for banners and badges. Info is deliberately a different hue from the default accent so status never looks like an action.
- **Color is never the only signal.** Status always pairs color with an icon or a word.
- **Creator content is the color.** Avatars, cover images, and lesson thumbnails supply visual interest; the frame stays neutral.

## Typography

**Recommendation:** **Inter** as the primary typeface, with Geist as the documented alternative.

Why Inter: open license (SIL OFL), a variable font with tabular figures (important for prices and leaderboards), wide script coverage (Latin extended, Cyrillic, Greek, Vietnamese) for international communities, and excellent legibility at 14 to 16px. Geist is also excellent but has narrower language coverage today and is strongly associated with another company's product identity.

- Fallback stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- Monospace (code, API keys, docs): `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`.
- Weights: 400 for body, 500 for labels and buttons, 600 for headings. No 700+ in product UI; marketing headlines may use 600 at large sizes.
- Scale: 12, 14, 16, 18, 20, 24, 30, 36px (full table with line heights in [design tokens](./design-tokens.md#typography)). Body text is 16px on mobile and desktop. 14px for metadata and dense tables. 12px only for badges and captions.
- Line length: 60 to 75 characters for posts and lessons (max width 680px for reading columns).
- Use tabular figures (`font-variant-numeric: tabular-nums`) for money, counts, and leaderboards.

## Spacing and layout grid

- **Confirmed:** 4px base with 8px rhythm. Most gaps are multiples of 8; 4px and 12px are for tight internal padding.
- Card padding: 16px on mobile, 24px on desktop. Gap between cards: 12px on mobile, 16px on desktop.
- **Recommendation:** layout. Desktop uses a top bar (community identity, the four tabs, search, account) and a centered content column. Feed and lessons: 680px reading column with an optional 280px right rail (about, upcoming event, leaderboard preview) at 1024px and up. Classroom and Members: 12 column grid, max width 1120px, 24px gutters.
- Page side padding: 16px mobile, 24px tablet, 32px desktop.

## Radii

**Confirmed:** cards 12 to 16px. Scale: sm 6px (badges, checkboxes), md 8px (buttons, inputs), lg 12px (cards, default), xl 16px (Soft card style, dialogs, cover images), full (avatars, pills). Nested elements use a smaller radius than their container.

## Borders over shadows

**Confirmed:** separation comes from a 1px `border` on a surface that is lighter than the background. **Recommendation:** inputs and controls use the stronger border (`border-strong`, 3:1 against surfaces) so their edges are perceivable, as WCAG 1.4.11 requires.

Shadows, minimal: two levels only, plus the resting shadow of the Soft card style (`--card-shadow-soft`, see [design-tokens](design-tokens.md)). `shadow-sm` for sticky headers on scroll and small raised controls. `shadow-md` for popovers, menus, dialogs, and toasts (things that float above the page). No colored shadows, no inner shadows, no shadow on hover as the only feedback.

## Iconography

- **Confirmed:** Lucide icons.
- **Recommendation:** 1.5px stroke at 20px (default in navigation and buttons), 16px inline with 14px text, 24px for bottom navigation and empty states. Stroke width scales with `absoluteStrokeWidth` so icons stay visually consistent.
- Icons inherit `currentColor`. Accent only for the active state.
- Icon-only buttons always have an accessible name (`aria-label`) and a tooltip on pointer devices.
- Navigation icons (Recommendation): Community `MessagesSquare`, Classroom `GraduationCap`, Calendar `CalendarDays`, Members `Users`. Manage uses `Settings2`.

## Imagery and illustration

- Creator imagery leads: community cover (shown at 4:1, recommended 1600 × 400 or larger; link previews may crop the sides), course thumbnails (16:9), avatars (square, displayed round).
- Missing images fall back to a flat tile in `accent-muted` with the first letter of the name in `accent`, never a stock photo.
- **Recommendation:** our own marketing illustration is minimal line work using the Lucide stroke style, neutral strokes with one accent fill. No 3D renders, no mascots, no people illustrations that imply a demographic.
- Screenshots in marketing show real product UI with clearly fictional sample data.

## Motion

**Recommendation:** motion explains a change; it never decorates.
- Durations: 120ms (hover, press, toggles), 180ms (menus, popovers, tabs), 240ms (dialogs, sheets, page level transitions). Nothing over 300ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for exiting.
- Allowed: fade, short translate (up to 8px), height expand for comment threads, progress bar fill.
- Not allowed: parallax, bouncing, confetti, auto-playing carousels, looping background animation.
- `prefers-reduced-motion: reduce` replaces translates and scales with opacity changes or nothing, and sets durations to 0ms for non-essential motion. Video never autoplays; gallery videos load their player only after a click.

## Dark mode

**Confirmed:** appearance options are Light, Dark, and System. **Assumption:** System is the default. **Recommendation:**
- Dark mode is a separate, tuned palette, not an inversion. Background `#0E131B`, surfaces step lighter as they rise (`#151B24`, `#1C2330`), so elevation reads through lightness instead of shadow.
- Text is `#F1F5F9`, not pure white, to reduce glare. No pure black.
- The default accent lightens to `#60A5FA` with dark text on top, to keep contrast at 4.5:1 or more.
- Creator accents are re-derived for dark mode automatically (see [creator accent](./design-tokens.md#creator-accent-color)).
- Images are not dimmed by default; cover images get a subtle 1px border so light images do not bleed into the page.

## Creator customization

**Confirmed:** creators can set accent color, logo, cover image, one of 3 curated fonts, card style (Soft or Minimal), and appearance (Light, Dark, System). All communities keep the same layout.

| Setting | What it changes | What it never changes |
| --- | --- | --- |
| Accent color | Primary buttons, links, active tab, focus ring, progress | Status colors, neutrals, text colors |
| Logo | Top bar, mobile header, emails, favicon fallback | Layout, navigation order |
| Cover image | The About page hero (also the owner's preview of it), "Your communities" cards, and link previews of a public community | Member pages, Feed, Classroom, or Members layouts |
| Font | Headings and the community name | Body text, UI controls, numbers (always the primary typeface) |
| Card style | Card radius, border, and shadow | Spacing, content order |
| Appearance | Default mode for members who have not chosen | A member's own explicit choice |

**Recommendation:** curated fonts are Inter (default), Source Serif 4 (editorial, for writers and educators), and Nunito Sans (rounded, friendly, for wellness and hobby communities). All are open license and support Latin extended. Body text stays Inter so readability and tabular numbers never depend on a creator's choice.

**Recommendation:** card styles. Minimal (default): 12px radius, 1px border, no shadow. Soft: 16px radius, 1px border, and a visible soft shadow (`--card-shadow-soft`: `0 1px 3px` plus `0 4px 12px` at low opacity in light, a darker and wider shadow in dark so it still reads on `#0E131B`). Hover states change the background or border, never the shadow.

**Recommendation:** no custom CSS, layout changes, extra navigation tabs, or arbitrary fonts in MVP. These would break consistency between communities and accessibility guarantees.

## Accessibility

**Recommendation:** WCAG 2.2 AA is a release requirement, not a later audit.
- Contrast: body and UI text 4.5:1 minimum; large text (24px, or 18.66px bold) 3:1; UI component boundaries and focus indicators 3:1 against adjacent colors. Ratios for every token pair are listed in [design tokens](./design-tokens.md#contrast-checks).
- Focus visible: 2px ring in `ring` color with a 2px offset in the surface color, on every interactive element, shown for keyboard focus (`:focus-visible`). Never remove outlines without a replacement.
- Target size: 44x44px minimum for touch targets on all breakpoints (stricter than the 24px AA minimum in WCAG 2.5.8). Small visual icons get padding to reach 44px. Controls that stay smaller on purpose (small and medium buttons, tab triggers, the field hint) use the `touch-hit` utility from `globals.css`, an invisible area of at least 44px around the control.
- Keyboard: every action reachable and operable by keyboard; logical tab order; Escape closes overlays and returns focus to the trigger; skip link to main content; arrow key navigation inside menus, tabs, and radio groups (Radix provides this).
- Screen readers: landmarks (`header`, `nav`, `main`), live regions for toasts and new comments, labeled form fields, errors linked with `aria-describedby`.
- Content: video lessons support captions; images require alt text in the composer (with a "decorative" option).
- Zoom and reflow: usable at 200% zoom and at 320px width without horizontal scrolling.

## Responsive behavior

- Breakpoints (Tailwind defaults): sm 640px, md 768px, lg 1024px, xl 1280px.
- **Confirmed:** below 768px the four member tabs (Community, Classroom, Calendar, Members) move to a fixed bottom navigation bar with icon and label, 64px tall plus the safe area inset. Manage is reached from the account menu in the top bar, never as a fifth tab.
- Below 768px: single column, right rail content moves into the feed (pinned event card) or into its tab, dialogs become bottom sheets, the composer opens full screen.
- 768px to 1023px: top bar with tabs, single content column, no right rail.
- 1024px and up: reading column plus right rail.
- The information hierarchy is the same on every size; only placement changes.

## Don'ts

- No heavy gradients. A flat accent is the default; gradients only inside creator-uploaded images.
- No glassmorphism, frosted panels, or backdrop blur (except a light blur behind the mobile bottom sheet overlay, if performance allows).
- No excessive shadows, stacked shadows, or glow effects.
- No unnecessary animation, auto-playing carousels, or celebratory effects.
- No second accent color, rainbow category colors, or colored section backgrounds.
- No text over images without a solid scrim that meets contrast.
- No icon-only navigation on mobile; labels stay visible. Exceptions in the platform bar (founder, 2026-10-20, H1): the search icon on phones ("Search this community") and the round avatar button ("Open account menu for {name}") have accessible names instead of visible labels. The tab bars always show labels.

## Decisions and open questions

- **Confirmed:** founder palette, one accent, borders over shadows, 12 to 16px card radius, Lucide, creator customization options, same layout for all communities, four member tabs with mobile bottom nav.
- **Recommendation:** Inter as primary typeface, Geist as alternative.
- **Recommendation:** curated fonts Inter, Source Serif 4, Nunito Sans; creator font applies to headings only.
- **Recommendation:** Minimal is the default card style.
- **Confirmed** (founder, 2026-10-20): the app icon before the wordmark "Cohory" in the platform bar, and the community logo and name in its place inside a community.
- **Assumption:** System is the default appearance for new communities.
- **Open question:** should members be able to override the community's appearance setting (current assumption: yes, members choose Light, Dark, or System for themselves)?
- **Open question:** final logo concept. The name is final (founder decision, 2026-10-19) and is written "Cohory" (founder decision, 2026-10-20).
