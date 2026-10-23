import { testDefaults } from "@cohory/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...testDefaults,
    fsModuleCachePath: "node_modules/.vitest-cache",
    projects: [{ test: { name: "unit", include: ["src/**/*.test.ts"] } }],
  },
});
