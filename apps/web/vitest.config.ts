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
          include: ["lib/**/*.test.ts"],
          exclude: ["lib/theme/theme-script.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "lib/theme/theme-script.test.ts",
            "components/**/*.test.tsx",
            "app/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
