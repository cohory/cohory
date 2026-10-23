import { describe, expect, it, vi } from "vitest";

import { api, createApi, createOpenApiDocument } from "./app";

describe("GET /api/v1/health/live", () => {
  it("responds with status ok as JSON", async () => {
    const response = await api.request("/api/v1/health/live");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("OpenAPI document", () => {
  it("declares OpenAPI 3.1 with title and version", () => {
    const document = createOpenApiDocument();

    expect(document.openapi).toMatch(/^3\.1\.\d+$/);
    expect(document.info.title).toBe("Cohory API");
    expect(document.info.version).toBeTypeOf("string");
  });

  it("documents the health route with its JSON response schema", () => {
    const document = createOpenApiDocument();
    const operation = document.paths?.["/api/v1/health"]?.get;

    expect(operation?.operationId).toBe("getHealth");
    expect(operation?.responses?.["200"]).toBeDefined();
    expect(operation?.responses?.["503"]).toBeDefined();
    expect(document.components?.schemas?.["Health"]).toBeDefined();
  });

  it("is served at /api/openapi.json", async () => {
    const response = await api.request("/api/openapi.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(createOpenApiDocument());
  });

  it("builds the document once per app and reuses it", () => {
    expect(createOpenApiDocument()).toBe(createOpenApiDocument());
  });

  it("names this server from APP_URL so tools know the base URL", () => {
    const app = createApi(() => {
      throw new Error("building the document needs no dependencies");
    });
    vi.stubEnv("APP_URL", "https://community.example.com/");
    try {
      expect(createOpenApiDocument(app).servers).toEqual([
        { url: "https://community.example.com", description: "This Cohory server" },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("OpenAPI document for communities", () => {
  const document = createOpenApiDocument();

  it.each([
    ["/api/v1/communities", "post", "createCommunity"],
    ["/api/v1/communities/me", "get", "listMyCommunities"],
    ["/api/v1/communities/{slug}", "get", "getCommunity"],
    ["/api/v1/communities/{slug}/join", "post", "joinCommunity"],
    ["/api/v1/communities/{slug}/leave", "post", "leaveCommunity"],
    ["/api/v1/communities/{slug}/membership", "get", "getMyMembership"],
  ] as const)(
    "documents %s %s as %s with success and error responses",
    (path, method, operationId) => {
      const pathItem = document.paths?.[path];
      const operation = method === "get" ? pathItem?.get : pathItem?.post;

      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual(expect.arrayContaining([{ sessionCookie: [] }]));
      const statuses = Object.keys(operation?.responses ?? {});
      expect(statuses.some((status) => status.startsWith("2"))).toBe(true);
      expect(statuses.some((status) => status.startsWith("4"))).toBe(true);
    },
  );

  it("declares the session cookie security scheme", () => {
    expect(document.components?.securitySchemes?.["sessionCookie"]).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "better-auth.session_token",
    });
  });

  it("registers the shared schemas", () => {
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Community", "Membership", "CreateCommunity", "Error"]),
    );
  });
});

describe("OpenAPI document for posts and comments", () => {
  const document = createOpenApiDocument();
  const methods = ["get", "post", "patch", "delete"] as const;

  it.each([
    ["/api/v1/communities/{slug}/posts", "get", "listPosts"],
    ["/api/v1/communities/{slug}/posts", "post", "createPost"],
    ["/api/v1/communities/{slug}/posts/{postId}", "get", "getPost"],
    ["/api/v1/communities/{slug}/posts/{postId}", "patch", "updatePost"],
    ["/api/v1/communities/{slug}/posts/{postId}", "delete", "deletePost"],
    ["/api/v1/communities/{slug}/posts/{postId}/pin", "post", "pinPost"],
    ["/api/v1/communities/{slug}/posts/{postId}/pin", "delete", "unpinPost"],
    ["/api/v1/communities/{slug}/posts/{postId}/like", "post", "likePost"],
    ["/api/v1/communities/{slug}/posts/{postId}/like", "delete", "unlikePost"],
    ["/api/v1/communities/{slug}/posts/{postId}/comments", "get", "listComments"],
    ["/api/v1/communities/{slug}/posts/{postId}/comments", "post", "createComment"],
    ["/api/v1/communities/{slug}/comments/{commentId}", "patch", "updateComment"],
    ["/api/v1/communities/{slug}/comments/{commentId}", "delete", "deleteComment"],
    ["/api/v1/communities/{slug}/comments/{commentId}/like", "post", "likeComment"],
    ["/api/v1/communities/{slug}/comments/{commentId}/like", "delete", "unlikeComment"],
    ["/api/v1/communities/{slug}/uploads/post-image", "post", "uploadPostImage"],
  ] as const)("documents %s %s as %s", (path, method, operationId) => {
    const operation = document.paths?.[path]?.[method];

    expect(methods).toContain(method);
    expect(operation?.operationId).toBe(operationId);
    const statuses = Object.keys(operation?.responses ?? {});
    expect(statuses.some((status) => status.startsWith("2"))).toBe(true);
    expect(statuses).toContain("404");
  });

  it("documents the image upload as multipart form data", () => {
    const body =
      document.paths?.["/api/v1/communities/{slug}/uploads/post-image"]?.post?.requestBody;

    expect(body).toMatchObject({ content: { "multipart/form-data": {} } });
  });

  it("registers the post schemas", () => {
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Post", "Comment", "CommentThread", "ContentDocument", "LikeState"]),
    );
  });
});

describe("OpenAPI document for the people filters", () => {
  it("types neverSignedIn as a boolean so generated clients send true or false", () => {
    const document = createOpenApiDocument();
    const params = Object.entries(document.paths ?? {})
      .filter(([path]) => path.startsWith("/api/v1/communities/{slug}/manage/"))
      .flatMap(([, item]) => item?.get?.parameters ?? [])
      .filter((param) => "name" in param && param.name === "neverSignedIn");

    expect(params.length).toBeGreaterThan(0);
    for (const param of params) {
      expect("schema" in param ? param.schema : undefined).toMatchObject({ type: "boolean" });
    }
  });
});
