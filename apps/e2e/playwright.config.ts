import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3310";
const isCI = process.env.CI === "true";

const memberJourneys = [
  /journey-03-join-free-community\.spec\.ts/,
  /journey-05-post-and-comment\.spec\.ts/,
  /journey-06-resume-course\.spec\.ts/,
  /journey-08-schedule-event\.spec\.ts/,
  /payments\.spec\.ts/,
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
    ["json", { outputFile: "./test-results/results.json" }],
  ],
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/Berlin",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: memberJourneys,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
