import { defineConfig } from "@playwright/test";

// ZWUI-024: browser integration tests run against a REAL server instance
// (node server/index.js + fake CLI) with the built web UI.
export default defineConfig({
  testDir: "./tests-browser",
  timeout: 30_000,
  // one worker: specs seed the shared .e2e SQLite store and drive the same
  // server — parallel workers made the DB-backed specs flake under lock
  // contention (reproduced repeatedly with the content-search spec)
  workers: 1,
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
