import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { api } from "@cohory/api";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";

import { mcpTools } from "./default";
import { renderToolReference, replaceReference } from "./reference";

const target = fileURLToPath(new URL("../../../docs/operations/mcp.md", import.meta.url));

describe("docs/operations/mcp.md", () => {
  it("lists every tool as the registry generates it", async () => {
    const current = await readFile(target, "utf8");
    const config = (await resolveConfig(target)) ?? {};
    const expected = await format(replaceReference(current, renderToolReference(mcpTools(api))), {
      ...config,
      filepath: target,
    });
    expect(current, "run `pnpm --filter @cohory/mcp reference`").toBe(expected);
  });
});
