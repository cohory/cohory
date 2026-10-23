import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Vitest matches threshold globs against paths relative to each package root, so the floors are
// keyed by package. They guard the money, permission, and access rules AGENTS.md section 4 names.
const coverageFloors = {
  "packages/authz": {
    "src/**/*.ts": { statements: 90, branches: 85, functions: 80, lines: 90 },
  },
  "packages/payments": {
    "src/fee.ts": { statements: 100, branches: 85, functions: 100, lines: 100 },
    "src/access.ts": { statements: 95, branches: 95, functions: 85, lines: 95 },
  },
  "packages/entitlements": {
    "src/access.ts": { statements: 75, branches: 75, functions: 75, lines: 75 },
    "src/community-access/membership-access.ts": {
      statements: 95,
      branches: 95,
      functions: 85,
      lines: 95,
    },
  },
};

const packageDir = relative(repoRoot, process.cwd());

// Turbo runs a few packages at once (see the root package.json), so each Vitest run gets a
// small worker pool instead of one worker per core. VITEST_MAX_WORKERS overrides it for a run.
export const testDefaults = {
  maxWorkers: 2,
  coverage: {
    provider: "v8",
    reporter: ["text-summary"],
    reportsDirectory: "node_modules/.vitest-coverage",
    thresholds: coverageFloors[packageDir] ?? {},
  },
};
