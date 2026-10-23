import { fileURLToPath } from "node:url";
import { base, fixedLocale, ignores, next, react, tokensOnly } from "@cohory/config/eslint";

const webRoot = fileURLToPath(new URL("apps/web/", import.meta.url));

export default [
  ignores,
  ...base,
  ...react,
  tokensOnly(["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"]),
  next(webRoot, ["apps/web/**/*.{ts,tsx}"]),
  fixedLocale(["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"]),
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}", "apps/worker/src/**/*.ts"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/test/**",
      "**/*-cli.ts",
      "**/cli.ts",
      "packages/infra/src/logger.ts",
      "packages/db/src/migrate.ts",
      "packages/db/src/seed.ts",
      "packages/email/src/drivers/log.ts",
      "packages/ui/**",
    ],
    rules: { "no-console": "error" },
  },
];
