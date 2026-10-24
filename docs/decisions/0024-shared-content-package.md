# 0024. Shared content package

The rich text document format moves from `@cohory/posts` into its own package, `@cohory/content`, so modules other than posts can validate and render the same format.

- ADR status: Accepted (founder, 2026-10-25)
- Date: 2026-10-20
- Deciders: Step 17 unit V2 (proposed)
- Related: [0012](0012-post-content-format.md), [../architecture/overview.md](../architecture/overview.md), [../architecture/data-model.md](../architecture/data-model.md)

## Context

Founder decision F7 (2026-10-20) gives every community a detailed description for its About page "in the post rich text format, rendered sanitized". The format, its strict schema, the escaping renderer, and the embed allowlist live in `@cohory/posts`. The detailed description belongs to the communities module, which owns the `communities` table. `@cohory/posts` already depends on `@cohory/communities` (for the archive guard and the upload limits), so the communities module cannot import posts without a dependency cycle, which AGENTS.md section 2 forbids. Gallery videos (F8) also need the embed allowlist on the server.

## Decision

**Recommendation.**

1. `packages/posts/src/content` moves unchanged to `packages/content` (`@cohory/content`), a leaf package that depends only on Zod.
2. `@cohory/posts` depends on it and re-exports the same names, so existing callers keep working. `@cohory/communities` and `@cohory/migration` import it directly.
3. The package gains `normalizeVideoLink`, which accepts a YouTube, Vimeo, or Loom link only after the existing `embedProviderOf` allowlist accepts its host and returns the provider's embed URL, and `videoProviderOfEmbedUrl`, which names the provider of a stored embed URL.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Inject a parser into the communities service from the delivery layer | No new package | Every caller of `getManageService` must wire it; easy to forget, and then descriptions go unvalidated | Validation is a business rule and belongs in the service. |
| Validate in the web server action only | Small change | REST and MCP writes would skip it | Breaks the rule that services enforce input. |
| Store the description as plain text | No format work | Contradicts F7 | Not what the founder decided. |

## Consequences

- Positive: one schema and one renderer for posts, comments, and the About page; no dependency cycle.
- Negative: one more workspace package to build and test. A change to the format now reaches communities too, which is intended.

## Open questions

- Whether `packages/ui` should also take its embed URL parsing from `@cohory/content`, so the browser and the server share one list.
