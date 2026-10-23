# Design tokens and product components

The token specification for Tailwind CSS v4 `@theme` and shadcn/ui, plus behavior specs for the ten product components.

Status: Draft, 2026-10-19

Intent and rationale live in [visual identity](./visual-identity.md). The machine-readable copy of the semantic color tokens is [colors.json](../../assets/brand/colors.json) and must match this doc exactly. Screen structure is in [information architecture](../product/information-architecture.md).

## Rules

1. **Recommendation:** three layers. Primitives (raw values) are referenced only by semantic tokens. Semantic tokens are what components use. Component aliases exist only where a creator setting or a shadcn/ui contract needs a seam.
2. **Recommendation:** components never use raw hex, rgb, or Tailwind palette classes (`bg-blue-600`, `text-[#111827]`). They use semantic utilities (`bg-surface`, `text-text-muted`, `border-border`). The Tailwind default palette is removed with `--color-*: initial`, so palette classes do not compile. A lint rule rejects hex literals and arbitrary color values in `packages/ui` and `apps/web`.
3. CSS variable naming: `--color-<role>[-<variant>]` for colors (`--color-bg`, `--color-surface-raised`, `--color-accent-foreground`), `--radius-<size>`, `--shadow-<level>`, `--text-<size>`, `--font-<family>`, `--z-<layer>`, `--duration-<speed>`, `--ease-<curve>`. Lowercase, kebab case, role before variant.
4. Light values are the default on `:root`. Dark values apply under `[data-theme="dark"]`. A small inline script in the root layout `<head>` (allowed by the request nonce of the Content Security Policy) sets `data-theme` on `<html>` before first paint, so there is no flash and no duplicated media query block. It reads `prefers-color-scheme` and follows it live when the device setting changes. A community whose Appearance is Light or Dark marks its root element with `data-force-theme`, and the script applies that value to `<html>` instead, so the whole page (background, platform bar, dialogs, and toasts) uses the community choice. The script watches the document with a mutation observer, which runs before the next paint, so the forced value also holds after client navigation and is dropped when the visitor leaves the community. System means each visitor's device setting decides. Platform pages outside a community always follow the device. Without JavaScript the page renders light.

## Primitive tokens

Primitives are not exposed as utilities. Names use a numeric lightness step; custom steps (450, 650, 925, 975) exist where a semantic role needed a value the standard steps did not provide.

| Scale | Steps |
| --- | --- |
| neutral | 0 `#FFFFFF`, 50 `#F8FAFC`, 100 `#F1F5F9`, 200 `#E5E7EB`, 300 `#CBD5E1`, 400 `#94A3B8`, 450 `#868F9F`, 500 `#64748B`, 600 `#475569`, 700 `#334155`, 900 `#111827` |
| ink (dark surfaces) | 950 `#0B1120`, 900 `#0E131B`, 850 `#151B24`, 800 `#1C2330`, 700 `#2A3240`, 500 `#6B7488` |
| blue | 50 `#EFF4FF`, 100 `#DBEAFE`, 300 `#93C5FD`, 400 `#60A5FA`, 600 `#2563EB`, 700 `#1D4ED8`, 925 `#16233D` |
| green | 50 `#F0FDF4`, 400 `#4ADE80`, 700 `#15803D`, 925 `#10241A`, 950 `#052E16` |
| amber | 50 `#FFFBEB`, 400 `#FBBF24`, 700 `#B45309`, 925 `#2A2110`, 975 `#1C1404` |
| red | 50 `#FEF2F2`, 400 `#F87171`, 650 `#C52A2A`, 925 `#2B1517`, 975 `#1F0707` |
| sky | 50 `#F0F9FF`, 400 `#38BDF8`, 700 `#0369A1`, 925 `#0F2533`, 950 `#082F49` |

Font families: `inter` (`var(--font-inter, Inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`), `source-serif` (`"Source Serif 4", ui-serif, Georgia, serif`), `nunito-sans` (`"Nunito Sans", ui-sans-serif, system-ui, sans-serif`), `mono` (`ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`). The web app loads Inter through `next/font`, which sets `--font-inter` to Inter followed by a size matched local fallback, and preloads it because it is the body font on every page, so text does not reflow when the font arrives. Source Serif 4 and Nunito Sans are only used for headings and are not preloaded.

## Semantic color tokens

**Confirmed** values from the founder are marked with (F). Everything else is **Recommendation**.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#F8FAFC` (F) | `#0E131B` | Page background |
| `--color-surface` | `#FFFFFF` (F) | `#151B24` | Cards, panels, inputs |
| `--color-surface-raised` | `#FFFFFF` | `#1C2330` | Popovers, menus, dialogs, toasts |
| `--color-surface-hover` | `#F8FAFC` | `#1C2330` | Hover and pressed rows on a surface |
| `--color-border` | `#E5E7EB` (F) | `#2A3240` | Card and divider lines (decorative) |
| `--color-border-strong` | `#868F9F` | `#6B7488` | Input, checkbox, and control boundaries |
| `--color-text` | `#111827` (F) | `#F1F5F9` | Primary text |
| `--color-text-muted` | `#64748B` (F) | `#94A3B8` | Secondary text, metadata, placeholders |
| `--color-text-subtle` | `#94A3B8` | `#64748B` | Disabled text and decorative icons only |
| `--color-accent` | `#2563EB` (F) | `#60A5FA` | Primary buttons, links, active tab, progress |
| `--color-accent-hover` | `#1D4ED8` | `#93C5FD` | Hover and pressed state of accent fills |
| `--color-accent-foreground` | `#FFFFFF` | `#0B1120` | Text and icons on accent fills |
| `--color-accent-muted` | `#EFF4FF` | `#16233D` | Selected rows, active nav pill, accent badges |
| `--color-success` | `#15803D` | `#4ADE80` | Success text and fills |
| `--color-success-foreground` | `#FFFFFF` | `#052E16` | Text on success fills |
| `--color-success-muted` | `#F0FDF4` | `#10241A` | Success banners and badges |
| `--color-warning` | `#B45309` | `#FBBF24` | Warning text and fills |
| `--color-warning-foreground` | `#FFFFFF` | `#1C1404` | Text on warning fills |
| `--color-warning-muted` | `#FFFBEB` | `#2A2110` | Warning banners and badges |
| `--color-danger` | `#C52A2A` | `#F87171` | Errors, destructive actions |
| `--color-danger-foreground` | `#FFFFFF` | `#1F0707` | Text on danger fills |
| `--color-danger-muted` | `#FEF2F2` | `#2B1517` | Error banners and field backgrounds |
| `--color-info` | `#0369A1` | `#38BDF8` | Informational text and fills |
| `--color-info-foreground` | `#FFFFFF` | `#082F49` | Text on info fills |
| `--color-info-muted` | `#F0F9FF` | `#0F2533` | Info banners and badges |
| `--color-ring` | `#2563EB` | `#60A5FA` | Focus ring (follows accent) |
| `--color-overlay` | `rgba(17, 24, 39, 0.48)` | `rgba(0, 0, 0, 0.60)` | Scrim behind dialogs and sheets |

None of the founder's six starting values were changed. Two roles were added because the founder values cannot cover them: `border-strong` (the founder border `#E5E7EB` is 1.24:1 on white, below the 3:1 that WCAG 1.4.11 requires for input boundaries) and `surface-hover`, which reuses the background value because any darker gray drops `text-muted` below 4.5:1 (for example `#64748B` on `#F1F5F9` is 4.34:1).

### Contrast checks

Ratios computed with the WCAG 2.x relative luminance formula. Text pairs need 4.5:1, non-text UI 3:1.

| Pair | Light | Dark | Requirement |
| --- | --- | --- | --- |
| text on bg | 16.96 | 17.00 | 4.5 |
| text on surface | 17.74 | 15.79 | 4.5 |
| text on surface-raised | 17.74 | 14.39 | 4.5 |
| text on accent-muted | 16.10 | 14.28 | 4.5 |
| text-muted on bg | 4.55 | 7.26 | 4.5 |
| text-muted on surface | 4.76 | 6.75 | 4.5 |
| text-muted on surface-raised | 4.76 | 6.15 | 4.5 |
| accent on bg (links) | 4.94 | 7.32 | 4.5 |
| accent on surface | 5.17 | 6.80 | 4.5 |
| accent on accent-muted | 4.69 | 6.16 | 4.5 |
| accent-foreground on accent | 5.17 | 7.41 | 4.5 |
| accent-foreground on accent-hover | 6.70 | 10.44 | 4.5 |
| border-strong on bg | 3.12 | 3.97 | 3.0 |
| border-strong on surface | 3.26 | 3.69 | 3.0 |
| border-strong on surface-raised | 3.26 | 3.36 | 3.0 |
| ring on bg | 4.94 | 7.32 | 3.0 |
| success on surface / on success-muted | 5.02 / 4.79 | 9.93 / 9.35 | 4.5 |
| success-foreground on success | 5.02 | 8.55 | 4.5 |
| warning on surface / on warning-muted | 5.02 / 4.84 | 10.36 / 9.51 | 4.5 |
| warning-foreground on warning | 5.02 | 10.93 | 4.5 |
| danger on surface / on danger-muted | 5.62 / 5.13 | 6.25 / 6.21 | 4.5 |
| danger-foreground on danger | 5.62 | 6.95 | 4.5 |
| info on surface / on info-muted | 5.93 / 5.57 | 8.07 / 7.36 | 4.5 |
| info-foreground on info | 5.93 | 6.48 | 4.5 |

Known limits: `text-muted` is close to the threshold on `bg` (4.55) and fails on `accent-muted` in light mode (4.32), so muted text is not placed on accent-muted backgrounds. `border` (1.24 light, 1.34 dark) is decorative only and never the sole boundary of a control. `text-subtle` (2.56 light) is only for disabled states, which WCAG exempts.

## Other scales

**Spacing** (4px base, Tailwind v4 `--spacing: 0.25rem`): allowed steps 0, 1 (4px), 2 (8px), 3 (12px), 4 (16px), 5 (20px), 6 (24px), 8 (32px), 10 (40px), 12 (48px), 16 (64px), 20 (80px), 24 (96px). Other steps need a review comment explaining why.

**Radius:** `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px, `--radius-xl` 16px, `--radius-full` 9999px. These override Tailwind's defaults (Tailwind's `rounded-sm` is 4px).

**Shadow** (two levels, everything else set to `initial`):

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(17, 24, 39, 0.06)` | `0 1px 2px rgba(0, 0, 0, 0.40)` |
| `--shadow-md` | `0 4px 12px rgba(17, 24, 39, 0.08), 0 1px 2px rgba(17, 24, 39, 0.04)` | `0 8px 24px rgba(0, 0, 0, 0.50)` |
| `--card-shadow-soft` | `0 1px 3px rgba(17, 24, 39, 0.08), 0 4px 12px rgba(17, 24, 39, 0.06)` | `0 1px 3px rgba(0, 0, 0, 0.60), 0 6px 16px rgba(0, 0, 0, 0.50)` |

`--card-shadow-soft` is not a third elevation level. It is the resting shadow of the Soft card style only, defined outside `@theme` (so there is no `shadow-card-soft` utility) and stronger than `--shadow-sm` so Soft cards read as raised in both modes. The dark value is darker and wider because a 2px shadow is invisible on `#0E131B`.

**Z-index:** `--z-base` 0, `--z-raised` 10 (sticky elements inside content), `--z-header` 20, `--z-nav` 30 (mobile bottom nav), `--z-overlay` 40, `--z-modal` 50, `--z-popover` 60, `--z-toast` 70, `--z-tooltip` 80. Used as `z-(--z-modal)`.

### Typography

| Token | Size | Line height | Weight | Use |
| --- | --- | --- | --- | --- |
| `--text-xs` | 12px | 16px | 500 | Badges, captions |
| `--text-sm` | 14px | 20px | 400 / 500 | Metadata, tables, secondary buttons |
| `--text-base` | 16px | 24px | 400 | Body, posts, lessons, inputs |
| `--text-lg` | 18px | 28px | 600 | Card titles |
| `--text-xl` | 20px | 28px | 600 | Section headings |
| `--text-2xl` | 24px | 32px | 600 | Page titles |
| `--text-3xl` | 30px | 36px | 600 | Community name in the About hero |
| `--text-4xl` | 36px | 44px | 600 | Marketing only |

Weights: `--font-weight-normal` 400, `--font-weight-medium` 500, `--font-weight-semibold` 600. Inputs are 16px on mobile so iOS does not zoom on focus.

**Image ratios:** the community cover is shown at a fixed 4:1 crop (`aspect-[4/1]`, uploaded at 1600 × 400 or larger) with `object-cover`, on the About hero at every screen size, on "Your communities" cards, and in the Manage, Appearance preview. It is also the Open Graph and Twitter card image of a public community, where link previews may crop the sides. Member pages show no cover.

**Breakpoints:** `--breakpoint-sm` 40rem (640px), `--breakpoint-md` 48rem (768px, bottom nav below this), `--breakpoint-lg` 64rem (1024px, right rail appears), `--breakpoint-xl` 80rem (1280px).

**Motion:** `--duration-fast` 120ms, `--duration-base` 180ms, `--duration-slow` 240ms, `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)`, `--ease-exit` `cubic-bezier(0.4, 0, 1, 1)`. Under `prefers-reduced-motion: reduce`, all three durations become `0ms` and components fall back to opacity changes.

## Component aliases

Only these, each with a reason:

| Alias | Default | Why it exists |
| --- | --- | --- |
| `--color-input` | `var(--color-border-strong)` | shadcn/ui contract for input borders |
| `--font-heading` | `var(--font-sans)` | Creator font setting applies to headings only |
| `--card-radius` | `var(--radius-lg)` | Card style setting (Minimal 12px, Soft 16px) |
| `--card-shadow` | `none` | Card style setting (Minimal none, Soft `var(--card-shadow-soft)`) |

Every card like surface inside a community (posts, the post composer, course, member, and event cards, their skeletons, the About sections and gallery, the locked section, empty states, the calendar month grid, lesson and course panels, the leaderboard, and dialogs) uses `rounded-(--card-radius)` and `shadow-(--card-shadow)`, never a fixed `rounded-lg`. Dialogs keep `shadow-md` and take only the radius. Stretched link overlays use `after:rounded-[inherit]` so the focus ring follows the radius. Controls (inputs, buttons, tabs, toggles, badges), the event date block, cover images, list rows nested in a card, and lesson video frames keep their own radius. Posts drop the radius, side borders, and shadow under 768px. Platform pages outside a community get the Minimal values from `:root`.

## Tailwind CSS v4 mapping

**Recommendation:** tokens live in `packages/ui/styles/tokens.css`, imported once by `apps/web`.

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  --color-*: initial;
  --shadow-*: initial;
  --font-sans: var(--font-inter, Inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  --font-heading: var(--font-sans);

  --color-bg: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-surface-raised: #FFFFFF;
  --color-surface-hover: #F8FAFC;
  --color-border: #E5E7EB;
  --color-border-strong: #868F9F;
  --color-input: var(--color-border-strong);
  --color-text: #111827;
  --color-text-muted: #64748B;
  --color-text-subtle: #94A3B8;
  --color-accent: #2563EB;
  --color-accent-hover: #1D4ED8;
  --color-accent-foreground: #FFFFFF;
  --color-accent-muted: #EFF4FF;
  /* success, warning, danger, info: solid, foreground, muted, as in the table */
  --color-ring: var(--color-accent);
  --color-overlay: rgba(17, 24, 39, 0.48);

  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px; --radius-full: 9999px;
  --shadow-sm: 0 1px 2px rgba(17, 24, 39, 0.06);
  --shadow-md: 0 4px 12px rgba(17, 24, 39, 0.08), 0 1px 2px rgba(17, 24, 39, 0.04);
  --text-base: 1rem; --text-base--line-height: 1.5rem;
  /* remaining type, breakpoint, and ease tokens as in the tables */
}

[data-theme="dark"] {
  --color-bg: #0E131B;
  --color-surface: #151B24;
  /* every semantic color and shadow token redefined with its dark value */
}
```

This yields utilities such as `bg-bg`, `bg-surface`, `text-text-muted`, `border-border-strong`, `bg-accent`, `text-accent-foreground`, `ring-ring`, `rounded-lg`, `shadow-sm`. The doubled names (`bg-bg`, `text-text`) are a deliberate trade for one consistent variable name per role.

### shadcn/ui mapping

**Recommendation:** we do not register shadcn's variable names as a second vocabulary. When a shadcn component is added to `packages/ui/primitives`, its classes are rewritten once using this table, and a lint check flags the left column in our code.

| shadcn/ui | cohory |
| --- | --- |
| `background` / `foreground` | `bg` / `text` |
| `card`, `card-foreground` | `surface`, `text` |
| `popover`, `popover-foreground` | `surface-raised`, `text` |
| `primary`, `primary-foreground` | `accent`, `accent-foreground` |
| `secondary`, `secondary-foreground` | `surface-hover` with `border`, `text` |
| `muted`, `muted-foreground` | `surface-hover`, `text-muted` |
| `accent`, `accent-foreground` (hover fill) | `surface-hover`, `text` |
| `destructive` | `danger` |
| `border`, `input`, `ring` | `border`, `input`, `ring` |
| `--radius` | `--radius-lg` |

Note the name clash: shadcn's `accent` is a neutral hover fill, our `accent` is the brand color. Copying shadcn code without the rewrite makes menus hover in the creator's accent.

## Creator accent color

**Confirmed:** creators can choose a custom accent. **Recommendation:** derive every accent token on save, server side, and store the result. Members never receive an unsafe combination.

1. **Validate.** Accept `#RRGGBB` only. Anything else uses the default accent.
2. **Light accent.** Convert to OKLCH. While contrast against `bg` (`#F8FAFC`) is below 4.5:1, lower lightness by 0.01 and clamp chroma into the sRGB gamut. This also guarantees white text on the accent passes.
3. **Light foreground.** `#FFFFFF` if it reaches 4.5:1 on the accent, else `#111827`.
4. **Light hover.** Accent lightness minus 0.06. **Light muted:** mix 8% accent into `#FFFFFF` in OKLab, then confirm accent on muted is at least 4.5:1, otherwise reduce the mix in 1% steps.
5. **Dark accent.** Starting from the creator's color, raise lightness by 0.01 until contrast against `surface-raised` (`#1C2330`) is at least 4.5:1. **Dark foreground:** `#0B1120` if it reaches 4.5:1, else `#FFFFFF`. **Dark hover:** lightness plus 0.06. **Dark muted:** mix 14% accent into `#151B24`, same check as step 4.
6. **Ring** equals the accent in each mode.
7. **Fallback.** If any step fails within 50 iterations, or the input is invalid, use the default accent tokens and tell the creator in Appearance ("This color can't be made readable. We're using the default blue.").
8. **Warn, do not block,** when the accent hue is within 20 degrees of the danger hue with high chroma ("Red accents can be confused with errors").

The derived tokens are injected as inline custom properties on the community root element, for example `style="--color-accent: #0F766E; --color-accent-hover: ...;"`, with a `[data-theme="dark"]` variant in a scoped style tag. Dialogs, menus, and toasts render in a portal outside the community root, so the community root carries `data-community-root`, its accent variables are also written to `:root` in a style tag, and `:root:has([data-community-root]...)` rules apply the accent, heading font, and card style to the whole page while a community page is open. The Appearance screen previews both modes and shows the computed ratios. The default accent bypasses derivation and uses the hand-tuned values above. The derivation function is pure and covered by unit tests, including near-white, near-black, pure red, and pure yellow inputs.

## Product components

**Recommendation:** folder mapping in `packages/ui`, based on the founder's structure. File names match component names in kebab case, so `post-card.tsx` becomes `community-post.tsx` and `provider-selector.tsx` becomes `payment-provider-selector.tsx`. A `calendar/` folder is added for EventCard.

```
packages/ui/src/
├── primitives/   button, dialog, input, tabs, progress, avatar, badge, card, sheet, tooltip, toast
├── community/    community-post, post-composer, comment-thread
├── members/      member-card, member-directory, leaderboard, level-badge, level-progress, member-profile-header, activity-list
├── classroom/    course-card, course-header, course-outline, lesson-player, outline-editor, lesson-form, publish-toggle
├── calendar/     event-card
└── payments/     pricing-card, checkout-summary, payment-provider-selector
```

Shared rules for all ten: built from `primitives` (Radix underneath), semantic tokens only, no data fetching inside the component (data and callbacks come in as props), skeletons sized like the final content for loading, every async action shows pending state on its own button, and errors render inline next to the cause.

### CommunityPost

- **Purpose:** show one post in the feed or on its detail page.
- **Anatomy:** author avatar and name, level badge, relative time, category, optional pinned marker; title; body (truncated to 5 lines in the feed with "Show more"); attachments; footer with like button and count, comment count, last commenter avatars; overflow menu.
- **States:** default; hover (whole card `surface-hover`, feed only); focus (ring on the card link); loading (skeleton); error (inline "Couldn't load this post. Retry."); deleted ("This post was removed"); deleted for moderators (when `post.deletion` is set: "Deleted by X" with the relative time, content hidden behind a "Show deleted post" toggle, no like, comment, or overflow actions).
- **Behavior:** the whole card opens the post, except interactive children. Like is optimistic and reverts on failure with a toast. Pinned posts show above the feed with a pin icon and the word "Pinned".
- **Accessibility:** card is an `article` with the title as heading; the card link is the title, extended with a pseudo-element so nested buttons stay separately focusable. Like is a toggle button with `aria-pressed` and a label including the count.
- **Responsive:** full width under 768px with 16px padding and no side borders or radius; attachments become a horizontal scroll strip.

```ts
interface CommunityPostProps {
  post: { id: string; title?: string | null; content: PostDocument; createdAt: string | Date; pinned?: boolean; category?: string | null; status?: "visible" | "deleted"; deletion?: { byName: string | null; at: string | Date } | null };
  author: { id: string; name: string; avatarUrl?: string | null };
  levelBadge?: ReactNode;
  likeCount: number; likedByViewer: boolean; commentCount: number;
  variant?: "feed" | "detail";
  href?: string; commentsHref?: string;
  onLike(): void; onOpenComments?(): void;
  actions?: Array<{ id: string; label: string; onSelect(): void; variant?: "default" | "danger" }>;
}
```

The sketch changed in 0.1.0. Bodies are a JSON document (`PostDocument` in `packages/ui/src/community/content.ts`) rather than `bodyHtml`, so the renderer never injects stored HTML and unsafe links are dropped at render time. Menu actions are objects built by the caller from the policy module, so labels and handlers stay outside the component. The level badge is a slot until gamification ships. The feed clamps the body to about 6 lines (the 0.1.0 design brief) instead of 5. Optimistic likes and the revert toast belong to the caller, which flips `likedByViewer` and `likeCount`.

### PostComposer

- **Purpose:** write a post in one or two interactions from the top of the feed.
- **Anatomy:** collapsed: avatar and a "Write something" field. Expanded: title, rich text body, category select, attachment button, Cancel and "Publish post".
- **States:** collapsed, expanded, focus, submitting (button pending, fields read-only), error (inline under the field, content preserved), disabled (members without posting rights see a one-line reason instead).
- **Behavior:** drafts autosave locally every 2 seconds; Escape with content asks to discard; Cmd or Ctrl plus Enter publishes; publish requires a title or body.
- **Accessibility:** labeled fields, toolbar uses `role="toolbar"` with arrow key navigation, upload progress announced politely, image alt text prompt.
- **Responsive:** under 768px expanding opens a full screen sheet with the publish button in the header.

```ts
interface PostComposerProps {
  canPost?: boolean; disabledReason?: string;
  showTitle?: boolean; maxLength?: number; maxImages?: number;
  error?: ReactNode;
  onSubmit(input: { title: string | null; document: PostDocument }): Promise<void> | void;
  onUploadImage(file: File): Promise<{ key: string; url: string; width?: number; height?: number }>;
  onResolveMention?(username: string): MentionTarget | null | Promise<MentionTarget | null>;
  onCancel?(): void;
}
```

The sketch changed in 0.1.0. The body is a plain textarea converted by `composeDocument` (blank lines, `**bold**`, `*italic*`, bare links, `@username`, and YouTube, Vimeo, or Loom links turned into embeds) instead of a rich text editor, so there is no toolbar yet. The primary button reads "Post". Category select, local draft autosave, and the full screen sheet under 768px are not built; on small screens the action row is sticky instead. The composer expands on click, Enter, or Space but not on focus alone, so tabbing through the feed never opens a form (WCAG 3.2.1). A rejected `onSubmit` keeps the draft and the caller shows the message through `error`.

### CommentThread

- **Purpose:** comments and one level of replies under a post.
- **Anatomy:** comment list (avatar, name, time, body, like, reply), reply composer, "Show 4 more replies" control.
- **States:** default, loading (3 skeleton rows), empty ("No comments yet. Start the conversation."), error per comment on failed send (with Retry), submitting.
- **Behavior:** replies nest one level only, deeper replies quote the parent; new comments from others appear with a "2 new comments" button instead of shifting content.
- **Accessibility:** list semantics, new comments announced via `aria-live="polite"`, reply focuses the composer and Escape returns focus.
- **Responsive:** indentation reduces from 40px to 24px under 768px.

```ts
interface CommentThreadProps {
  comments: Array<{ id: string; parentId?: string | null; author: { id: string; name: string; avatarUrl?: string | null }; content: PostDocument; createdAt: string | Date; likeCount: number; likedByViewer: boolean; status?: "visible" | "deleted"; deletion?: { byName: string | null; at: string | Date } | null; actions?: ItemAction[] }>;
  hasMore?: boolean; loadingMore?: boolean; pendingNewCount?: number;
  onLoadMore?(): void; onShowNew?(): void;
  onReply?(input: { parentId: string; document: PostDocument }): Promise<void> | void;
  onLike(commentId: string): void;
}
```

The sketch changed in 0.1.0. Comment bodies use the same `PostDocument`, restricted to paragraphs and inline nodes. A reply to a reply is attached to the top level comment instead of quoting the parent, and deleted comments show "This comment was deleted" while their replies stay visible. Since 0.1.0 moderators and above also receive deleted comments with a `deletion`; those render through `DeletedNotice` ("Deleted by X", content hidden until "Show deleted comment"). New top level comments are written with `CommentComposer`, which the page places under the post.

### CourseCard

- **Purpose:** represent a course in Classroom and in the "Continue learning" slot on the community home.
- **Anatomy:** 16:9 cover (fallback letter tile), title, short description (2 lines), progress meter and percent, lock state with plan name if not entitled, primary action.
- **States:** default, hover (border to `border-strong`), focus, loading, locked ("Included in Premium"), completed (check icon and "Completed"), draft (creator only badge).
- **Behavior:** action label is "Start", "Continue", or "Review"; locked cards open the plan's join page, never a dead end.
- **Accessibility:** progress meter uses `role="progressbar"` with value text "4 of 12 lessons"; lock state written, not just an icon.
- **Responsive:** 1 column under 640px, 2 at 640px, 3 at 1024px.

```ts
interface CourseCardProps {
  course: { id: string; title: string; description?: string; coverUrl?: string; lessonCount: number };
  progress?: { completedLessons: number };
  access: { kind: "open" } | { kind: "locked"; planName: string } | { kind: "draft" };
  onOpen(): void;
}
```

The sketch changed in 0.1.0:

```ts
interface CourseCardProps {
  course: { slug: string; title: string; description?: string | null; coverUrl?: string | null; lessonCount: number; status?: "draft" | "published" | "archived" };
  progressPercent?: number | null;
  href: string;
  actions?: ItemAction[];
  variant?: "grid" | "list";
}
```

Courses are addressed by slug in URLs, so the card is a link (`href`) like CommunityPost and MemberCard instead of an `onOpen` callback. Progress arrives as a percentage because the progress service already computes it and the card does not know which lessons are published. The draft badge reads from `course.status`. Locked cards and the "Start", "Continue", or "Review" action are not built because MVP courses are open to all members (REQ-CRS-002); `CourseHeader` carries the primary action on the course page and the feed's "Up next" row carries "Continue" on the community home.

### LessonPlayer

- **Purpose:** focus on one lesson without distraction.
- **Anatomy:** video or embed area (16:9), title, body content, attachments, "Mark complete" and "Next lesson"; LessonSidebar alongside with modules and lessons.
- **States:** loading (poster skeleton), playing, error ("This video couldn't load. Try again or download the file."), locked, completed.
- **Behavior:** resumes video at the last position; marks complete automatically at 90% watched or by button; Next moves to the next unlocked lesson; keyboard shortcuts only when the player has focus.
- **Accessibility:** captions toggle and transcript link when provided; native or accessible player controls; focus moves to the lesson title on navigation.
- **Responsive:** sidebar becomes a "Lessons" sheet under 1024px; video stays full width at the top.

```ts
interface LessonPlayerProps {
  lesson: { id: string; title: string; bodyHtml: string; media?: { kind: "video" | "embed"; url: string; captionsUrl?: string; durationSec?: number } };
  resumeAtSec?: number; completed: boolean; nextLessonId?: string;
  onProgress(positionSec: number): void;
  onComplete(): Promise<void>; onNext(): void;
}
```

The sketch changed in 0.1.0:

```ts
interface LessonPlayerProps {
  lesson: { title: string; videoUrl?: string | null; videoProvider?: "youtube" | "vimeo" | "loom" | "wistia" | null; bodyHtml: string; attachments: Array<{ name: string; href: string; size: number; contentType: string }> };
  completed: boolean;
  onToggleComplete(): void | Promise<void>;
  previousHref?: string | null; nextHref?: string | null;
  onNavigate?(href: string): void;
  sidebar?: ReactNode; sidebarOpen: boolean; onToggleSidebar(): void;
}
```

Video is a link from the post embed allowlist plus Wistia, loaded only after a click, so there is no resume position, progress callback, or automatic completion (REQ-LSN-002 keeps completion manual in MVP). Completion is a toggle so a member can undo it. Previous and Next are links; `onNavigate` lets the page use client routing. The sidebar is a slot (usually `CourseOutline`) that the page opens and closes; under 1024px it is a toggled panel above the lesson instead of a sheet. Shortcuts listen on the document and skip text fields: left and right arrows for Previous and Next, `m` for completion.

### MemberCard

- **Purpose:** show a member in the Members directory.
- **Anatomy:** avatar, name, level, short bio, joined date, online dot with text, role badge for creator and moderators, action (View profile).
- **States:** default, hover, focus, loading, removed ("No longer a member").
- **Behavior:** creators see an overflow with Change role and Remove member (with confirmation); members never see admin actions.
- **Accessibility:** online status has a text alternative; card is a link with nested actions separately focusable.
- **Responsive:** grid card at 640px and up, compact row under 640px.

```ts
interface MemberCardProps {
  member: { userId: string; name: string; username?: string | null; image?: string | null; role: "owner" | "admin" | "moderator" | "member"; level: number; levelName?: string | null; points: number; joinedAt: string | Date };
  href: string;
  actions?: Array<{ id: string; label: string; onSelect(): void; variant?: "default" | "danger" }>;
  variant?: "list" | "grid";
  gamificationEnabled?: boolean;
}
```

The sketch changed in 0.1.0. The card is a link (`href`) instead of an `onOpen` callback, and admin actions are caller built objects (the same `ItemActionsMenu` contract as CommunityPost) instead of `viewerCanManage` plus handlers, so the policy decision stays with the caller. Online status and bio are left out because no presence or bio data exists yet; the bio lives on the profile header. The owner role reads "Creator" per the voice guide. The component lives in `packages/ui/src/members` with the directory controls (`MemberSearch`, `LevelFilter`, `MemberList`), `LevelBadge`, `LevelProgress`, `MemberProfileHeader`, and `ActivityList`.

### Leaderboard

- **Purpose:** show points ranking for a period on Members and in the right rail.
- **Anatomy:** period tabs (7 days, 30 days, All time), ranked rows (rank, avatar, name, points with tabular figures), the viewer's own row pinned at the bottom if outside the list.
- **States:** default, loading, empty ("Points appear here when members post, comment, and finish lessons."), error.
- **Behavior:** top 3 use a medal icon with text rank, not color alone; compact variant shows 5 rows.
- **Accessibility:** ordered list, period tabs use Radix Tabs, points read as "120 points".
- **Responsive:** full variant on Members; compact in the right rail at 1024px and up.

```ts
interface LeaderboardProps {
  window: "7d" | "all";
  onWindowChange(window: "7d" | "all"): void;
  entries: Array<{ rank: number; member: { userId: string; name: string; image?: string | null; level: number; levelName?: string | null }; points: number; href?: string }>;
  viewer?: { rank: number; points: number } | null;
  disabled?: boolean;
  limit?: number;
  emptyMessage?: string;
}
```

The sketch changed in 0.1.0. The Members tab spec in the information architecture names two windows (7 days and All time), so `30d` is dropped and the prop is renamed `window` to match the gamification contract. Ranks come from the caller so ties share a rank. A compact rail variant is the same component with `limit={5}`. `disabled` renders "Leaderboard is turned off for this community" when the creator turns gamification off.

### EventCard

- **Purpose:** show an event in Calendar and as the next event in the feed or rail.
- **Anatomy:** date block (weekday, day, month), title, start and end time with time zone, recurrence marker, "Online" or "In person", going count, RSVP buttons, overflow menu.
- **States:** default, hover, focus, loading (skeleton), going (pressed "Going" with "Can't go" to change), canceled (muted title with strike, "Canceled" label, no RSVP). Live and past states, the join button, and the recording link live on the event details screen.
- **Behavior:** times render in the time zone the caller passes, with the zone abbreviation shown; "Going" is the single primary action until the viewer is going; the "Join call" button on event details appears 15 minutes before start.
- **Accessibility:** date and time in a `time` element with ISO `datetime`; status written in text; RSVP buttons are toggle buttons with `aria-pressed` in a labelled group.
- **Responsive:** list row in Calendar, compact row in the feed rail.

```ts
interface EventCardProps {
  occurrence: { id: string; eventSlug: string; title: string; startsAt: string; endsAt: string; canceled: boolean; recurrence: "weekly" | null; goingCount: number; viewerStatus: "going" | "not_going" | null; locationKind: "link" | "text" | null };
  timeZone: string;
  href: string;
  onRsvp?(status: "going" | "not_going"): void;
  rsvpPending?: boolean;
  actions?: ItemAction[];
  variant?: "list" | "compact";
}
```

The sketch changed in 0.1.0. The card shows one occurrence of a possibly repeating event, so it takes an occurrence with the viewer's RSVP instead of an event with a status. The location itself is hidden from people who are not members, so the card gets only its kind. Join, recording, and live states moved to `EventDetail`, which has the full location. The join window is 15 minutes, matching the information architecture, instead of 10. "Canceled" uses the spelling of the `canceled` field.

### PricingCard

- **Purpose:** present one membership plan on the join page and in Manage.
- **Anatomy:** plan name, price with currency and interval, optional trial note, included items list, primary action, small print for taxes.
- **States:** default, selected (accent border and `accent-muted` background), focus, loading, disabled ("Not available"), current plan ("Your plan").
- **Behavior:** prices always show currency and two decimals; interval toggle (monthly, yearly) lives outside the card; one card may be marked "Recommended" by the creator.
- **Accessibility:** when used as a choice, cards are a Radix RadioGroup; price is read in full ("29 US dollars per month").
- **Responsive:** stacked under 768px, side by side above (max 3 plans per row).

```ts
interface PricingCardProps {
  plan: { id: string; name: string; amountMinor: number; currency: string; interval: "month" | "year" | "one_time"; trialDays?: number; features: string[] };
  state: "default" | "selected" | "current" | "disabled";
  recommended?: boolean;
  onSelect(): void;
}
```

### PaymentProviderSelector

- **Purpose:** let a creator choose how they get paid in Manage, Payments.
- **Anatomy:** option list (Stripe Connect; Bring your own provider marked "Planned"), each with a plain description, fee line ("Platform fee: 2%. Processing fees charged by the provider."), and a status (Not connected, Connected, Needs attention).
- **States:** default, focus, connecting (pending button), connected (success text with account name), needs attention (warning with the exact fix), error, disabled (planned options and self-hosted editions show the reason).
- **Behavior:** **Confirmed:** Stripe Connect is the MVP option; BYO provider is post-MVP and renders as disabled with "Planned". Self-hosted Community Edition shows "No platform fee" instead of the 2% line. Disconnect requires a confirmation that states what stops and what stays (see [voice and tone](./voice-and-tone.md)).
- **Accessibility:** RadioGroup with descriptions linked by `aria-describedby`; status changes announced.
- **Responsive:** single column at all sizes.

```ts
interface PaymentProviderSelectorProps {
  edition: "community" | "cloud";
  options: Array<{ id: "stripe_connect" | "byo"; availability: "available" | "planned"; status: "not_connected" | "connected" | "needs_attention"; accountLabel?: string; attentionMessage?: string }>;
  platformFeeBasisPoints: number; // 100 on cloud, 0 on community
  onConnect(id: "stripe_connect" | "byo"): Promise<void>;
  onDisconnect(id: "stripe_connect" | "byo"): Promise<void>;
}
```

## Decisions and open questions

- **Confirmed:** founder starting values for bg, surface, text, text-muted, border, accent, and the 12px default radius; all kept unchanged.
- **Confirmed:** creator customization options and the ten product components.
- **Recommendation:** added `border-strong`, `surface-hover`, `surface-raised`, `text-subtle`, accent variants, and semantic status colors, with dark values above.
- **Recommendation:** remove Tailwind's default palette; lint for raw colors; rewrite shadcn class names on import.
- **Recommendation:** server-side accent derivation with contrast enforcement and fallback.
- **Recommendation:** rename `post-card.tsx` and `provider-selector.tsx` to match component names; add `calendar/`.
- **Recommendation:** themes are resolved before first paint by the inline script that sets `data-theme` on `<html>`, so no `prefers-color-scheme` duplication is needed in CSS. A community Light or Dark setting wins over the device; System follows the device.
- **Open question:** should the fee base and rounding shown in PaymentProviderSelector come from the payments module as a formatted string, to keep one source of truth? See [payments architecture](../architecture/payments.md).
- **Open question:** automatic completion threshold for LessonPlayer (90% proposed).
