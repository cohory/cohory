import { describe, expect, it } from "vitest";

import { api, createOpenApiDocument } from "./app";

const methods = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof methods)[number];

interface Operation {
  readonly summary?: string;
  readonly requestBody?: unknown;
  readonly parameters?: readonly unknown[];
  readonly responses?: Record<string, { readonly content?: Record<string, { schema?: unknown }> }>;
}

type PathItem = Partial<Record<Method, Operation>>;

const document = (await (await api.request("/api/openapi.json")).json()) as {
  paths: Record<string, PathItem>;
};

function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?/g, "{$1}");
}

const registered = api.routes
  .filter((route) => route.method !== "ALL" && route.path.startsWith("/api/v1/"))
  .map((route) => ({
    method: route.method.toLowerCase() as Method,
    path: toOpenApiPath(route.path),
  }))
  .filter(
    (route, index, all) =>
      all.findIndex((other) => other.method === route.method && other.path === route.path) ===
      index,
  );

describe("OpenAPI coverage", () => {
  it("finds the registered API routes", () => {
    expect(registered.length).toBeGreaterThan(50);
  });

  it("documents every registered /api/v1 route", () => {
    const missing = registered
      .filter((route) => !document.paths[route.path]?.[route.method])
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);

    expect(missing).toEqual([]);
  });

  it("gives every operation a summary and at least one response schema", () => {
    const gaps: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of methods) {
        const operation = item[method];
        if (!operation) continue;
        if (!operation.summary?.trim()) gaps.push(`${method.toUpperCase()} ${path}: summary`);
        const schemas = Object.values(operation.responses ?? {}).flatMap((response) =>
          Object.values(response.content ?? {}).filter((media) => media.schema !== undefined),
        );
        if (schemas.length === 0) gaps.push(`${method.toUpperCase()} ${path}: response schema`);
      }
    }

    expect(gaps).toEqual([]);
  });

  it("documents the 429 answer on every rate limited operation", () => {
    const limited = [
      ["post", "/api/v1/communities/{slug}/posts"],
      ["post", "/api/v1/communities/{slug}/posts/{postId}/comments"],
      ["post", "/api/v1/communities/{slug}/posts/{postId}/like"],
      ["delete", "/api/v1/communities/{slug}/posts/{postId}/like"],
      ["post", "/api/v1/communities/{slug}/comments/{commentId}/like"],
      ["delete", "/api/v1/communities/{slug}/comments/{commentId}/like"],
      ["post", "/api/v1/communities/{slug}/calendar/occurrences/{occurrenceId}/rsvp"],
      ["post", "/api/v1/communities/{slug}/manage/invites"],
      ["post", "/api/v1/invites/{token}/redeem"],
    ] as const;

    const missing = limited
      .filter(([method, path]) => !document.paths[path]?.[method]?.responses?.["429"])
      .map(([method, path]) => `${method.toUpperCase()} ${path}`);

    expect(missing).toEqual([]);
  });

  it("limits the body size of every operation that takes a body and documents the 413", () => {
    const missing = Object.entries(document.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method]?.requestBody && !item[method]?.responses?.["413"])
        .map((method) => `${method.toUpperCase()} ${path}`),
    );

    expect(missing).toEqual([]);
  });

  it("documents the 422 answer on every operation that takes parameters or a body", () => {
    const missing = Object.entries(document.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => {
          const operation = item[method];
          if (!operation) return false;
          const takesInput =
            operation.requestBody !== undefined || (operation.parameters?.length ?? 0) > 0;
          return takesInput && !operation.responses?.["422"];
        })
        .map((method) => `${method.toUpperCase()} ${path}`),
    );

    expect(missing).toEqual([]);
  });

  it("documents the 308 redirect on every route under a community slug", () => {
    const missing = Object.entries(document.paths)
      .filter(([path]) => path.startsWith("/api/v1/communities/{slug}"))
      .flatMap(([path, item]) =>
        methods
          .filter((method) => item[method] && !item[method]?.responses?.["308"])
          .map((method) => `${method.toUpperCase()} ${path}`),
      );

    expect(missing).toEqual([]);
  });

  it("answers every list in one shape: data plus nextCursor", () => {
    const schemas = (createOpenApiDocument().components?.schemas ?? {}) as Record<string, unknown>;
    const singleDocuments = new Set(["#/components/schemas/Gallery"]);
    const resolve = (schema: unknown): Record<string, unknown> | null => {
      if (!schema || typeof schema !== "object") return null;
      if ("$ref" in schema && typeof schema.$ref === "string") {
        if (singleDocuments.has(schema.$ref)) return null;
        return resolve(schemas[schema.$ref.replace("#/components/schemas/", "")]);
      }
      return schema as Record<string, unknown>;
    };
    const missing = Object.entries(document.paths).flatMap(([path, item]) =>
      methods.flatMap((method) => {
        const media = item[method]?.responses?.["200"]?.content?.["application/json"];
        const properties = resolve(media?.schema)?.properties as
          Record<string, { type?: unknown }> | undefined;
        return properties?.data?.type === "array" && !properties.nextCursor
          ? [`${method.toUpperCase()} ${path}`]
          : [];
      }),
    );

    expect(missing).toEqual([]);
  });

  it("documents no path that is not registered", () => {
    const known = new Set(registered.map((route) => `${route.method} ${route.path}`));
    const extra = Object.entries(document.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method] && !known.has(`${method} ${path}`))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );

    expect(extra).toEqual([]);
  });

  it("matches the document the app serves", () => {
    expect(Object.keys(createOpenApiDocument().paths ?? {}).sort()).toEqual(
      Object.keys(document.paths).sort(),
    );
  });
});
