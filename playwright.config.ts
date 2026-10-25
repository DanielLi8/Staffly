import { defineConfig, devices } from "@playwright/test";

// The port is configurable so a local run can target its own dev server (and
// its own database) instead of reusing whatever already listens on :3000 -
// `reuseExistingServer` would otherwise silently test against it. The app's
// NEXTAUTH_URL must point at the same origin (it is also the base URL Twilio
// webhook signatures are computed against).
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
