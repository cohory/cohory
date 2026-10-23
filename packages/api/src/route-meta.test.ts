import { approvalActions, matrix, scopes, type Resource } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import { api } from "./app";
import { cohoryExtension, routeScopes } from "./route-meta";

interface Operation {
  readonly operationId?: string;
  readonly [cohoryExtension]?: { operationId: string; scope: string | null; action: string | null };
}

const document = (await (await api.request("/api/openapi.json")).json()) as {
  paths: Record<string, Record<string, Operation>>;
};

const operations = Object.entries(document.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => ({ path, method, operation })),
);

const knownActions = new Set(
  (Object.keys(matrix) as Resource[]).flatMap((resource) =>
    Object.keys(matrix[resource]).map((action) => `${resource}.${action}`),
  ),
);

describe("route scope metadata", () => {
  it("declares x-cohory on every /api/v1 operation with its own operation id", () => {
    const missing = operations
      .filter(({ operation }) => operation[cohoryExtension]?.operationId !== operation.operationId)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

    expect(operations.length).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it("uses only known scopes and policy actions", () => {
    for (const { operation } of operations) {
      const meta = operation[cohoryExtension];
      if (meta?.scope) expect(scopes).toContain(meta.scope);
      if (meta?.action) expect(knownActions).toContain(meta.action);
    }
  });

  it("keeps every table entry in use", () => {
    const used = new Set(operations.map(({ operation }) => operation.operationId));
    expect(Object.keys(routeScopes).filter((id) => !used.has(id))).toEqual([]);
  });

  it("keeps token and agent management session only", () => {
    for (const id of [
      "listMyApiTokens",
      "createMyApiToken",
      "revokeMyApiToken",
      "listAgents",
      "createAgent",
      "updateAgent",
      "revokeAgent",
      "createAgentToken",
      "revokeAgentToken",
    ] as const) {
      expect(routeScopes[id].scope).toBeNull();
    }
  });

  it("never grants a read scope to a write that needs approval, except exports", () => {
    for (const [id, meta] of Object.entries(routeScopes)) {
      const category = meta.action ? approvalActions[meta.action] : undefined;
      if (category && category !== "data_export" && meta.scope) {
        expect([id, meta.scope.endsWith(":write") || meta.scope === "members:moderate"]).toEqual([
          id,
          true,
        ]);
      }
    }
  });
});
