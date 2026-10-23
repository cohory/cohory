import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

const rootEnvFile = new URL("../../.env", import.meta.url);
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      process.env.DATABASE_URL ??
      "postgres://cohory:cohory@localhost:5433/cohory",
  },
  strict: true,
  verbose: true,
});
