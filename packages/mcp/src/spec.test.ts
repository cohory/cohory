import { describe, expect, it } from "vitest";

import { insufficientScopeErrorCode, serverInfo } from "./handler";
import { headerMismatchCode, unsupportedProtocolVersionCode } from "./modern";
import { caller, harness, json, rpc } from "./test/harness";

interface RpcBody {
  id?: unknown;
  result?: Record<string, unknown> & {
    tools?: { name: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

async function body(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}

const noApi = () => json({ error: { code: "unexpected", message: "not called" } }, 500);

let nextId = 1000;

function modern(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string | null> = {},
): Request {
  const name = typeof params.name === "string" ? params.name : null;
  const all: Record<string, string | null> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer cohory_test",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
    ...headers,
  };
  const sent: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) if (value !== null) sent[key] = value;
  return new Request("https://cohory.test/mcp", {
    method: "POST",
    headers: sent,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

describe("protocol revision 2026-07-28 (stateless requests)", () => {
  it("answers server/discover with every supported version and the server identity", async () => {
    const { handle } = harness(caller(["posts:read"]), noApi);
    const response = await handle(modern("server/discover"));
    expect(response.status).toBe(200);
    const result = (await body(response)).result;
    expect(result).toMatchObject({
      resultType: "complete",
      capabilities: { tools: {} },
      _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
    });
    expect(result?.supportedVersions).toEqual(
      expect.arrayContaining(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]),
    );
  });

  it("lists tools in a stable order with a private cache hint", async () => {
    const { handle } = harness(caller(["posts:read"]), noApi);
    const result = (await body(await handle(modern("tools/list")))).result;
    expect(result?.tools?.map((tool) => tool.name)).toEqual([
      "get_post",
      "list_post_drafts",
      "list_posts",
      "list_scheduled_posts",
      "search_community",
    ]);
    expect(result).toMatchObject({ resultType: "complete", cacheScope: "private" });
    expect(typeof result?.ttlMs).toBe("number");
  });

  it("calls a tool through the same REST dispatch", async () => {
    const { handle, requests } = harness(caller(["posts:read"]), () => json({ id: "p1" }));
    const result = (
      await body(
        await handle(modern("tools/call", { name: "get_post", arguments: { postId: "p1" } })),
      )
    ).result;
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ resultType: "complete", structuredContent: { status: 200 } });
  });

  it("accepts a base64 encoded Mcp-Name header", async () => {
    const { handle } = harness(caller(["posts:read"]), () => json({ id: "p1" }));
    const encoded = `=?base64?${Buffer.from("get_post").toString("base64")}?=`;
    const response = await handle(
      modern(
        "tools/call",
        { name: "get_post", arguments: { postId: "p1" } },
        { "mcp-name": encoded },
      ),
    );
    expect(response.status).toBe(200);
  });

  it("refuses requests whose headers do not match the body with HeaderMismatch", async () => {
    const { handle, requests } = harness(caller(["posts:read"]), noApi);
    const cases = [
      modern("tools/list", {}, { "mcp-method": "tools/call" }),
      modern("tools/list", {}, { "mcp-method": null }),
      modern(
        "tools/call",
        { name: "get_post", arguments: { postId: "p1" } },
        { "mcp-name": "list_posts" },
      ),
    ];
    for (const request of cases) {
      const response = await handle(request);
      expect(response.status).toBe(400);
      expect((await body(response)).error?.code).toBe(headerMismatchCode);
    }
    expect(requests).toHaveLength(0);
  });

  it("answers an unknown method with 404 Method not found", async () => {
    const { handle } = harness(caller(["posts:read"]), noApi);
    const response = await handle(modern("resources/list"));
    expect(response.status).toBe(404);
    expect((await body(response)).error?.code).toBe(-32601);
  });

  it("answers an unknown protocol version with UnsupportedProtocolVersion and the supported list", async () => {
    const { handle } = harness(caller(["posts:read"]), noApi);
    const response = await handle(rpc("tools/list", {}, {}));
    expect(response.status).toBe(200);
    const unknown = await handle(
      modern("tools/list", {}, { "mcp-protocol-version": "1900-01-01" }),
    );
    expect(unknown.status).toBe(400);
    const error = (await body(unknown)).error;
    expect(error?.code).toBe(unsupportedProtocolVersionCode);
    expect(error?.data).toMatchObject({ requested: "1900-01-01" });
    expect(error?.data?.supported).toEqual(expect.arrayContaining(["2026-07-28", "2025-11-25"]));
  });
});

describe("transport security", () => {
  it("refuses a browser request from another origin with 403", async () => {
    const { handle } = harness(caller(["posts:read"]), noApi);
    const foreign = rpc("tools/list");
    foreign.headers.set("origin", "https://evil.example");
    expect((await handle(foreign)).status).toBe(403);
    const same = rpc("tools/list");
    same.headers.set("origin", "https://cohory.test");
    expect((await handle(same)).status).toBe(200);
  });

  it("authenticates once per tool call and hands the result to the REST dispatch", async () => {
    let authentications = 0;
    const who = caller(["posts:read"]);
    const seen: unknown[] = [];
    const { handle } = harness(who, () => json({ id: "p1" }), {
      authenticate: async () => {
        authentications += 1;
        return who;
      },
      fetchApi: async (_request, passed) => {
        seen.push(passed.authenticated);
        return json({ id: "p1" });
      },
    });
    await handle(rpc("tools/call", { name: "get_post", arguments: { postId: "p1" } }));
    expect(authentications).toBe(1);
    expect(seen).toEqual([who]);
  });
});

describe("scope challenges for OAuth access tokens", () => {
  const oauth = { oauthGrantId: "0192f0c0-0000-7000-8000-0000000000dd" };

  it("answers 403 insufficient_scope with the scopes to ask for", async () => {
    const { handle, requests } = harness(caller(["posts:read"], oauth), noApi);
    const response = await handle(
      rpc("tools/call", { name: "create_draft_post", arguments: { title: "Hi" } }),
    );
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="posts:write"');
    expect(challenge).toContain(
      'resource_metadata="https://cohory.test/.well-known/oauth-protected-resource/mcp"',
    );
    const error = (await body(response)).error;
    expect(error?.code).toBe(insufficientScopeErrorCode);
    expect(error?.data).toMatchObject({ code: "insufficient_scope" });
    expect(requests).toHaveLength(0);
  });

  it("asks for the area scope and proposals:write when an approval needs both", async () => {
    const { handle } = harness(caller(["posts:read"], oauth), noApi);
    const response = await handle(
      rpc("tools/call", { name: "propose_settings_change", arguments: {} }),
    );
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("settings:read");
    expect(challenge).toContain("proposals:write");
  });

  it("keeps the tool error for pasted agent tokens, which cannot step up", async () => {
    const { handle } = harness(caller(["posts:read"]), () =>
      json({ error: { code: "insufficient_scope", message: "Missing." } }, 403),
    );
    const response = await handle(
      rpc("tools/call", { name: "create_draft_post", arguments: { title: "Hi" } }),
    );
    expect(response.status).toBe(200);
    expect((await body(response)).result?.isError).toBe(true);
  });
});
