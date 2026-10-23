# @cohory/sdk

Typed client for the Cohory REST API, generated from the OpenAPI document.

Status: Draft, 2026-10-19

## Install

The package lives in this workspace and is not published to npm yet. Inside the monorepo, add it as a dependency with `"@cohory/sdk": "workspace:*"`.

## Use

`baseUrl` is the site origin (for example `https://learn.example.com`). Every path already starts with `/api/v1`. When `token` is set, each request sends `Authorization: Bearer <token>`.

```ts
import { createClient } from "@cohory/sdk";

const cohory = createClient({
  baseUrl: "https://learn.example.com",
  token: process.env.COHORY_TOKEN,
});

const { data, error } = await cohory.GET("/api/v1/communities/{slug}/posts", {
  params: { path: { slug: "makers" }, query: { sort: "new", limit: 20 } },
});

if (error) {
  console.error(error.error.code, error.error.message);
} else {
  console.log(data.data.length, "posts");
}
```

The client is [openapi-fetch](https://openapi-ts.dev/openapi-fetch/), so `GET`, `POST`, `PATCH`, `PUT`, and `DELETE` take the path as written in the API reference and check path parameters, query parameters, request bodies, and responses against the generated types. Pass `fetch` to use a custom fetch implementation and `headers` to add headers to every request. The types `paths`, `components`, and `operations` are exported for your own helpers.

## Regenerate

`src/schema.ts` is generated from the API routes in `@cohory/api`. After changing a route, run:

```sh
pnpm --filter @cohory/sdk generate
```

`pnpm --filter @cohory/sdk check` fails when `src/schema.ts` no longer matches the routes.

## License

The SDK, including the generated client in `src/schema.ts`, is MIT licensed ([LICENSE](LICENSE)) so integrations and plugins can stay proprietary. The rest of Cohory is AGPL-3.0; see [LICENSING.md](../../LICENSING.md) and [ADR 0009](../../docs/decisions/0009-license.md).
