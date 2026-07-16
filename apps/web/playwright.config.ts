import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run start --workspace=@loreline/server",
      url: "http://127.0.0.1:3001/api/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run start --workspace=@loreline/web",
      env: {
        SERVER_INTERNAL_URL: "http://127.0.0.1:3001",
      },
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
