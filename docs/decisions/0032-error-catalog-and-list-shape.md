# 0032. One error catalog, one list shape, and a rendered API reference

Every domain error code maps to one kind and one message in a catalog that the API and the web app share. Every list in `/api/v1` answers `{ data, nextCursor }`. `/docs/api` renders the OpenAPI document on the server.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: coordinator as product owner (review of 2026-10-21)
- Related: [../architecture/agent-integrations.md](../architecture/agent-integrations.md) section 2, [../operations/api-tokens.md](../operations/api-tokens.md), [0025](0025-reviews-module-boundary.md)

## Context

The architecture review found every domain error written twice: once in `packages/api/src/errors.ts`, a chain of about 40 `instanceof` branches, and again in five `apps/web/lib/*/errors.ts` files for server actions. The two copies had drifted ("Ask the operator" in the API, "Ask the server admin" in the web app). The code review found nine identical branches for module validation errors.

The API review found three list shapes: reviews used `page`, `pageSize`, `total`, and `hasMore`, subscriber discovery used `rows`, and many lists had no `nextCursor` at all, while the architecture doc promised `{ data, nextCursor }`. The OpenAPI document was rebuilt on every request, 16 operations with input did not list 422, and the 308 for a renamed community was not documented. The Postgres review found reviews paged with OFFSET up to page 10000 and counted every visible review on each page. The developer pages review found that "API reference" opened 482 KB of raw JSON, `/docs/api` answered 404, and the document had no `servers`.

## Decision

1. **Catalog.** `packages/api/src/error-catalog` holds one catalog per module, keyed by the module's stable error `code`. Each entry has a `kind` (`validation`, `unauthenticated`, `payment_required`, `forbidden`, `not_found`, `conflict`, `gone`, `too_large`, `rate_limited`, `unavailable`) and a `message`. A message can be built from the error's own data (a date, a limit, a count). `describeError(error, audience?)` returns `{ kind, code, message, details?, issues? }` or null for an unknown error.
2. **Kind to status.** The API maps each kind to one HTTP status (422, 401, 402, 403, 404, 409, 410, 413, 429, 503). An unknown error is 500 `internal_error`.
3. **Shared by web.** Server actions import the catalog from `@cohory/api/errors`, a subpath with no Hono code, and show the same message as the API. For a validation error both surfaces take the field messages from the error's `issues`: the API returns them in `details`, a server action shows the first one.
4. **Audience variants.** An entry may add a `creator` or `member` variant when one audience must not see the default text, for example "New paid signups are paused until the platform invoice is paid" for the owner and "New memberships are paused" for a buyer. The API always uses the default `message`. A test fails when a server action and the API disagree for a code without a variant.
5. **Validation errors once.** Any error with `code` `validation_failed` and an `issues` array of `{ path, message }` is a validation error. Module error classes do not need a shared base class, so the catalog does not import their validation classes.
6. **One list shape.** `cursorQuery()` and `cursorPage(schema)` in `packages/api/src/pagination.ts` define `?cursor=&limit=` and `{ data, nextCursor }`. Every list response has both keys. Lists that always fit in one page (they have a hard cap, such as 20 webhook endpoints, or list one person's own items, such as their communities) answer `nextCursor: null` and take no cursor, so a client can use one loop for every list and those lists can add paging later without a breaking change. The gallery is one document in display order, not a list, and keeps `{ data }`. An OpenAPI coverage test fails when a 200 response has a `data` array without `nextCursor`.
7. **Reviews cursor.** Reviews page with a `(created_at, id)` keyset cursor on `reviews_community_created_idx`, 10 per page by default and at most 50, and no longer count every visible review on each page. The rating summary already returns the counts the page shows.
8. **OpenAPI document.** It is built once per app and served from one serialized copy. It lists `APP_URL` as its server. Every operation with path, query, or body input documents 422, and every route under `/communities/{slug}` documents the 308 with its `Location` header.
9. **Reference.** `/docs/api` is a server rendered page built from the same document, with a quickstart (token, base URL, community slug, a curl request, MCP setup) and every operation grouped by tag with its scope, parameters, body fields, and responses. It loads no third party script, stylesheet, or service, and adds no dependency.

## Alternatives considered

- **Messages in each module's `errors.ts`.** Keeps the message next to the error, but puts user facing copy in domain packages and still leaves the web app to choose a message per surface. Rejected; modules keep codes only.
- **A new `v2` for the list shape.** Before 1.0 the API is not a stable contract (see [../product/feature-inventory.md](../product/feature-inventory.md)), so the change ships in `v1` with a CHANGELOG entry and a regenerated SDK.
- **Lists without paging keep `{ data }`.** Smaller diff, but clients would need two code paths and adding paging later would change the shape again.
- **Swagger UI, Redoc, or Scalar for `/docs/api`.** Each adds a large client bundle and a dependency, and some load fonts or scripts from a CDN by default. A server rendered page needs neither and follows the design tokens.

## Consequences

- A new error code is one catalog entry, and the type checker fails when a module adds a code without one.
- Some web messages changed to the shared wording, for example "Memberships are not for sale right now" and "We could not find that member." instead of a refresh hint.
- Breaking for API clients: reviews take `cursor` and `limit` instead of `page` and return `nextCursor` instead of `page`, `pageSize`, `total`, and `hasMore`; subscriber discovery returns `data` instead of `rows`; list responses gain `nextCursor`.
- Rate limited answers say how long to wait ("Try again in 2 minutes") on both surfaces.
- The timestamp in a review cursor has millisecond precision, the same as the member and audit cursors. Two reviews in the same millisecond can be skipped at a page boundary.

## Decisions and open questions

| Label | Item |
|---|---|
| Recommendation | The catalog lives in `packages/api` because both the API and the web app already depend on it. |
| Recommendation | Unbounded lists without real paging yet (approvals history, scheduled posts, drafts, invites, courses, migration jobs) answer `nextCursor: null`; give them a keyset cursor when they grow. |
| Open question | Whether `/docs/api` should also show response schemas field by field, not only status and description. |
