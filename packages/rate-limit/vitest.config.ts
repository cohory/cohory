import { testDefaults } from "@cohory/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...testDefaults,
    fsModuleCachePath: "node_modules/.vitest-cache",
    include: ["src/**/*.test.ts"],
  },
});
