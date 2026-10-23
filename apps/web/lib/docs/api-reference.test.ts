import { createOpenApiDocument } from "@cohory/api";
import { describe, expect, it } from "vitest";

import { buildReference } from "./api-reference";

const document = {
  openapi: "3.1.0",
  servers: [{ url: "https://learn.example.com" }],
  paths: {
    "/api/v1/communities/{slug}/posts": {
      post: {
        operationId: "createPost",
        tags: ["Posts"],
        summary: "Create a post",
        "x-cohory": { scope: "posts:write" },
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/NewPost" } } },
        },
        responses: {
          "422": { description: "Not valid." },
          "201": { description: "Created." },
        },
      },
      get: {
        operationId: "listPosts",
        tags: ["Posts"],
        summary: "List posts",
        "x-cohory": { scope: null },
        responses: { "200": { description: "A page of posts." } },
      },
    },
    "/api/v1/health": {
      get: { operationId: "getHealth", tags: ["Health"], summary: "Check health" },
    },
  },
  components: {
    schemas: {
      NewPost: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "Up to 200 characters." },
          tags: { type: "array", items: { type: "string" } },
          status: { enum: ["draft", "published"] },
        },
      },
    },
  },
};

describe("buildReference", () => {
  const reference = buildReference(document);

  it("groups operations by tag in name order and reads the server URL", () => {
    expect(reference.serverUrl).toBe("https://learn.example.com");
    expect(reference.tags.map((tag) => [tag.name, tag.anchor])).toEqual([
      ["Health", "health"],
      ["Posts", "posts"],
    ]);
  });

  it("lists parameters, resolved body fields, the scope, and responses by status", () => {
    const create = reference.tags[1]?.operations.find((operation) => operation.id === "createPost");

    expect(create).toMatchObject({
      method: "POST",
      path: "/api/v1/communities/{slug}/posts",
      scope: "posts:write",
      parameters: [{ name: "slug", location: "path", type: "string", required: true }],
      body: {
        contentType: "application/json",
        fields: [
          {
            name: "title",
            type: "string",
            required: true,
            description: "Up to 200 characters.",
          },
          { name: "tags", type: "string[]", required: false },
          { name: "status", type: '"draft" | "published"', required: false },
        ],
      },
      responses: [
        { status: "201", description: "Created." },
        { status: "422", description: "Not valid." },
      ],
    });
  });

  it("marks session only operations with a null scope", () => {
    const list = reference.tags[1]?.operations.find((operation) => operation.id === "listPosts");
    expect(list?.scope).toBeNull();
  });

  it("renders every operation of the real API document", () => {
    const real = createOpenApiDocument();
    const count = Object.values(real.paths ?? {}).reduce(
      (total, item) =>
        total + ["get", "post", "put", "patch", "delete"].filter((method) => method in item).length,
      0,
    );
    const operations = buildReference(JSON.parse(JSON.stringify(real))).tags.flatMap(
      (tag) => tag.operations,
    );
    expect(operations).toHaveLength(count);
  });
});
