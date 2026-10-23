import { defineConfig } from "vitest/config";

import { testDefaults } from "./vitest.js";

export default defineConfig({
  test: {
    ...testDefaults,
    fsModuleCachePath: "node_modules/.vitest-cache",
    include: ["src/**/*.test.ts"],
  },
});
