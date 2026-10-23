import { testDefaults } from "@cohory/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...testDefaults,
    fsModuleCachePath: "node_modules/.vitest-cache",
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          include: ["src/**/*.integration.test.ts"],
          globalSetup: ["src/test/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
