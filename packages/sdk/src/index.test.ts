import { describe, expect, it, vi } from "vitest";

import { createClient } from "./index";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_request: Request) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function requestOf(fetch: ReturnType<typeof fakeFetch>): Request {
  const request = fetch.mock.calls[0]?.[0];
  if (!request) {
    throw new Error("fetch was not called");
  }
  return request;
}

describe("createClient", () => {
  it("joins the site origin with the API path and fills path and query parameters", async () => {
    const fetch = fakeFetch(200, { data: [], nextCursor: null });
    const cohory = createClient({ baseUrl: "https://learn.example.com/", fetch });
    await cohory.GET("/api/v1/communities/{slug}/posts", {
      params: { path: { slug: "makers" }, query: { sort: "new", limit: 5 } },
    });
    const url = new URL(requestOf(fetch).url);
    expect(url.origin).toBe("https://learn.example.com");
    expect(url.pathname).toBe("/api/v1/communities/makers/posts");
    expect(url.searchParams.get("sort")).toBe("new");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("sends the token as a bearer header", async () => {
    const fetch = fakeFetch(200, { status: "ok" });
    const cohory = createClient({
      baseUrl: "https://learn.example.com",
      token: "cohory_secret",
      headers: { "X-Trace": "1" },
      fetch,
    });
    await cohory.GET("/api/v1/health");
    const request = requestOf(fetch);
    expect(request.headers.get("Authorization")).toBe("Bearer cohory_secret");
    expect(request.headers.get("X-Trace")).toBe("1");
  });

  it("sends no authorization header without a token", async () => {
    const fetch = fakeFetch(200, { status: "ok" });
    await createClient({ baseUrl: "https://learn.example.com", fetch }).GET("/api/v1/health");
    expect(requestOf(fetch).headers.has("Authorization")).toBe(false);
  });

  it("returns the typed error body on a 4xx response", async () => {
    const fetch = fakeFetch(404, { error: { code: "not_found", message: "Gone." } });
    const cohory = createClient({ baseUrl: "https://learn.example.com", fetch });
    const { data, error, response } = await cohory.GET("/api/v1/communities/{slug}/posts", {
      params: { path: { slug: "missing" } },
    });
    expect(response.status).toBe(404);
    expect(data).toBeUndefined();
    expect(error?.error.code).toBe("not_found");
  });
});
