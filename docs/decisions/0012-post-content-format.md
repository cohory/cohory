# 0012. Post content format

Store post and comment bodies as a constrained JSON document, with a server-rendered sanitized HTML cache and a plain text column next to it.

Status: Draft, 2026-10-19

- ADR status: Proposed
- Date: 2026-10-18
- Deciders: engineering (posts module, 0.1.0)
- Related: [../architecture/data-model.md](../architecture/data-model.md) sections 1 and 5, [../product/mvp-scope.md](../product/mvp-scope.md) section 2.4, [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 9, [0003](0003-drizzle-orm.md), [0011](0011-mcp-first-class-api-surface.md)

## Context

Posts and comments carry rich text: bold, italic, inline code, links, lists, quotes, code blocks, mentions, video embeds from YouTube, Vimeo, Loom, and Wistia (REQ-POST-006), and up to 10 images per post (REQ-POST-001). Polls, attachments, link previews, and images in comments are out of scope for the MVP (mvp-scope 2.4). The acceptance criteria require that disallowed HTML and scripts are stripped.

The content is untrusted. It is shown to members in the web UI, read by agents through the API and MCP, sent in notification emails, and exported. Mentions must resolve to members of the same community. The feed renders 20 posts per page and must stay fast. data-model.md section 1 already recommends a sanitized JSON document plus a derived plain text column.

## Decision

**Recommendation.**

1. The stored source of truth is a JSON document in the editor's shape (TipTap and ProseMirror style): `{ "type": "doc", "content": [...] }`.
2. The allowed node set is fixed and small. Blocks: `paragraph`, `bulletList`, `orderedList`, `listItem`, `blockquote`, `codeBlock`, `embed`, `image` (posts only). Inline: `text` with `bold`, `italic`, `code`, and `link` marks, `mention`, `hardBreak`. Every node and attribute schema is strict, so an unknown attribute such as `onerror` fails validation instead of being dropped silently.
3. The service validates every write with Zod (`parseContent` in `@cohory/posts`) and answers `validation_failed` on any violation. Limits: 20,000 characters of text, 10 images, 10 embeds, 50 mentions, 5,000 nodes, nesting depth 8 for lists and quotes. A shape check without recursion runs before the Zod parse so a hostile, deeply nested payload cannot exhaust the stack.
4. Links accept only `http`, `https`, and `mailto`. Embeds accept only `https` URLs on an allowlist of hosts: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `vimeo.com`, `www.vimeo.com`, `player.vimeo.com`, `loom.com`, `www.loom.com`, `fast.wistia.net`, `fast.wistia.com`, and `<account>.wistia.com`. Image nodes may only reference keys under `communities/{communityId}/posts/` that the upload endpoint produced.
5. On write the server also stores two derived columns:
   - `body_html`, sanitized HTML rendered by `renderContentHtml`. The renderer builds HTML from the validated tree and escapes every text and attribute value, so no user supplied markup ever reaches the output. Links get `rel="noopener noreferrer nofollow ugc"` and `target="_blank"`. Embeds render as a placeholder `<div data-embed data-embed-provider data-embed-url>` with a plain link inside, never an iframe, so the UI decides when to load third-party players (REQ-POST-006: no third-party scripts until the member clicks play).
   - `body_text`, plain text for search and agents, and on posts an `excerpt` of up to 280 characters for previews and notifications.
6. Mentions are `mention` nodes with a user id and a display label. On write the service keeps only ids of active members of the same community and turns the rest into plain `@label` text. The resolved ids (minus the author) are returned to the caller for notifications. Usernames are not resolved because the users table has no username yet.
7. Like and comment counts are denormalized on `posts.like_count`, `posts.comment_count`, and `comments.like_count`, and updated in the same transaction as the reaction or comment write. The feed shows both counts on every card, so counting rows per page would cost a grouped query per request on the hottest read path. Reactions use a unique key per subject, user, and kind, so a repeated like inserts nothing and leaves the count unchanged. A repair job can recompute counts if they ever drift (data-model.md section 5).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Sanitized HTML as the stored source | Simple to render, no conversion step | Sanitizer configuration is the whole security boundary, mentions and embeds must be parsed back out of markup, editor round trips drift, hard to validate limits structurally | A tree with a closed node set is easier to validate and to reason about than an HTML allowlist. |
| Markdown | Familiar to developers and agents, compact | Ambiguous dialects, raw HTML passthrough must be disabled everywhere, mentions and embeds need custom syntax, rich editors convert lossy | Kept for lesson bodies (mvp-scope 2.5), not for the feed. |
| JSON document only, render on read | One column, no cache invalidation | Every feed page renders 20 documents per request, agents and emails need their own renderer | Rendering once on write is cheaper and gives one canonical HTML for every surface. |
| Count rows on read instead of counters | Always exact | A grouped count per page on the hottest query, worse as communities grow | Counters in the same transaction stay exact under the unique constraint and are cheap to read. |

## Consequences

- Positive: the security boundary is a strict schema plus an escaping renderer, both covered by tests with hostile inputs (`javascript:` URLs, event handler attributes, script text, deep nesting, oversize text).
- Positive: the UI, API, MCP, emails, and exports read the same `body_html` and `body_text`, and agents can still read the structured `body`.
- Negative: `body_html` is a cache. Changing the renderer or the storage public URL needs a backfill job that re-renders from `body`.
- Negative: the web editor must emit exactly this node set. Unknown nodes are rejected, not stripped, so editor upgrades need a schema review.
- Follow-up: rate limits for post, comment, like, and upload endpoints (multi-tenancy.md section 7) are documented in the API but not enforced yet.
- Follow-up: serving post images of private communities needs an access checked route; the current uploads route only serves public keys.

## Open questions

- Whether mentions should also resolve usernames once a username column exists.
- Whether to add headings and tables to the node set after the MVP.
