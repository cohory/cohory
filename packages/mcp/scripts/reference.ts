import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgres://mcp:mcp@127.0.0.1:1/mcp";
process.env.BETTER_AUTH_SECRET ??= "mcp-reference-only-secret-not-used-at-runtime";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.APP_URL ??= "http://localhost:3000";

const target = fileURLToPath(new URL("../../../docs/operations/mcp.md", import.meta.url));

const { mcpTools, renderToolReference } = await import("../src/index");
const { replaceReference } = await import("../src/reference");
const prettier = await import("prettier");

const current = await readFile(target, "utf8");
const config = (await prettier.resolveConfig(target)) ?? {};
const output = await prettier.format(replaceReference(current, renderToolReference(mcpTools())), {
  ...config,
  filepath: target,
});

if (process.argv.includes("--check")) {
  if (current !== output) {
    console.error("docs/operations/mcp.md is stale. Run `pnpm --filter @cohory/mcp reference`.");
    process.exit(1);
  }
  console.log("docs/operations/mcp.md tool reference is up to date.");
} else {
  await writeFile(target, output);
  console.log(`wrote ${target}`);
}
process.exit(0);
