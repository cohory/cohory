import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { securityHeaderRules } from "./lib/security-headers";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const rootEnvFile = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@cohory/api", "@cohory/auth", "@cohory/db", "@cohory/storage", "@cohory/ui"],
  serverExternalPackages: ["pg"],
  headers: async () => securityHeaderRules(),
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
