# Brand assets

Where Cohory's logo files, favicons, social cards, and color swatches will live, and how to name and export them.

**Confirmed:** no final assets exist yet. "Cohory" is the final name (founder, 2026-10-19), but the final logo is undecided; the interim app icon is `apps/web/app/icon.svg` (see [visual identity](../../docs/brand/visual-identity.md#logo-direction)). The only file here today is [colors.json](./colors.json), the machine-readable copy of the semantic color tokens defined in [design tokens](../../docs/brand/design-tokens.md#semantic-color-tokens).

## Planned contents

**Recommendation:**

```
assets/brand/
├── README.md
├── colors.json            semantic color tokens, light and dark
├── logo/
│   ├── cohory-mark-color.svg
│   ├── cohory-mark-mono-dark.svg
│   ├── cohory-mark-mono-light.svg
│   ├── cohory-wordmark-color.svg
│   ├── cohory-wordmark-mono-dark.svg
│   ├── cohory-wordmark-mono-light.svg
│   └── cohory-lockup-horizontal-color.svg
├── favicon/
│   ├── favicon.svg
│   ├── favicon.ico         16, 32, 48 px
│   ├── apple-touch-icon.png  180 x 180
│   ├── icon-192.png
│   └── icon-512.png
├── social/
│   ├── og-default-1200x630.png
│   └── github-social-1280x640.png
└── swatches/
    └── colors-light-dark.svg
```

## Naming conventions

- Lowercase, words separated by hyphens: `<name>-<asset>-<variant>[-<size>].<ext>`.
- `<asset>` is one of `mark`, `wordmark`, `lockup`, `og`, `github-social`, `icon`.
- `<variant>` describes color use: `color` (accent plus text color), `mono-dark` (single dark color, for light backgrounds), `mono-light` (single light color, for dark backgrounds).
- Sizes in pixels as `<width>x<height>` for raster files.
- Cohory is the final name (2026-10-19). If it ever changes, rename every file in one commit. Never keep two names side by side.

## Export rules

- **SVG is the source of truth** for marks, wordmarks, and favicons. Outline all text, remove editor metadata, keep a `viewBox`, no fixed `width` or `height`, no embedded raster images, and run through SVGO.
- **Colors in SVG** use only values from [colors.json](./colors.json) (`text` and `accent` for light, their dark equivalents for dark variants). The favicon SVG may use `prefers-color-scheme` to switch between the two.
- **Raster exports** (PNG) are generated from SVG by a script, never edited by hand. Export at 1x and 2x where relevant, sRGB, transparent background for icons, solid `bg` color for social cards.
- **Clear space** around the mark equals half the mark's height. **Minimum size:** 16px for the mark, 80px wide for the wordmark.
- **Social cards** use the `bg` background, the wordmark, one line of copy from the [brand strategy](../../docs/brand/brand-strategy.md#tagline-candidates), and no screenshots with real personal data.
- **Optimization:** SVG under 4 KB for marks, PNG under 200 KB for social cards.

## Updating colors.json

`colors.json` must match the semantic color table in [design tokens](../../docs/brand/design-tokens.md#semantic-color-tokens) exactly. `packages/ui/src/tokens.test.ts` fails the unit tests when `packages/ui/styles/tokens.css` and this file disagree.

## Decisions and open questions

- **Confirmed:** no final assets exist; the name is final and the logo is undecided.
- **Recommendation:** folder layout, naming scheme, and export rules above.
- **Open question:** whether to generate `tokens.css` from `colors.json` instead of keeping both by hand under the test.
