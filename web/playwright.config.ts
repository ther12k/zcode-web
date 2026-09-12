import { defineConfig } from "@playwright/test";

// ZWUI-024: browser integration tests run against a REAL server instance
// (node server/index.js + fake CLI) with the built web UI.
export default defineConfig({
  testDir: "./tests-browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3472",
    headless: true,
  },
  webServer: {
    command: "npm --prefix .. run serve:test",
    url: "http://127.0.0.1:3472/api/health",
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
