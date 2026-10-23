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
          testTimeout: 15_000,
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          testTimeout: 15_000,
          include: ["src/**/*.test.tsx"],
          exclude: ["src/**/*.integration.test.tsx"],
        },
      },
      {
        test: {
          name: "integration",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          include: ["src/**/*.integration.test.{ts,tsx}"],
        },
      },
    ],
  },
});
