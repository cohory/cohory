import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgres://sdk:sdk@127.0.0.1:1/sdk";
process.env.BETTER_AUTH_SECRET ??= "sdk-generation-only-secret-not-used-at-runtime";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.APP_URL ??= "http://localhost:3000";

const target = fileURLToPath(new URL("../src/schema.ts", import.meta.url));
const header =
  "// Generated from the cohory OpenAPI document by `pnpm --filter @cohory/sdk generate`. Do not edit.\n\n";

async function render(): Promise<string> {
  const { createOpenApiDocument } = await import("@cohory/api");
  const { default: openapiTS, astToString } = await import("openapi-typescript");
  const document = JSON.parse(JSON.stringify(createOpenApiDocument()));
  const ast = await openapiTS(document);
  const prettier = await import("prettier");
  const config = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(header + astToString(ast), { ...config, filepath: target });
}

const output = await render();

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== output) {
    console.error("src/schema.ts is stale. Run `pnpm --filter @cohory/sdk generate`.");
    process.exit(1);
  }
  console.log("src/schema.ts is up to date.");
} else {
  await writeFile(target, output);
  console.log(`wrote ${target}`);
}
process.exit(0);
