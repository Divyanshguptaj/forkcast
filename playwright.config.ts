import { defineConfig, devices } from "@playwright/test";

const PORT = 3110;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `npm run build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      timeout: 240_000,
      reuseExistingServer: true,
    },
    {
      command: "node --import tsx tests/e2e/harness/server.ts",
      url: "http://localhost:3130/__state",
      timeout: 60_000,
      reuseExistingServer: true,
    },
  ],
});
