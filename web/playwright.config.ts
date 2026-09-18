import { defineConfig } from "@playwright/test";

// ZWUI-024: browser integration tests run against a REAL server instance
// (node server/index.js + fake CLI) with the built web UI. The port is
// E2E_PORT-overridable: another container on this host's network namespace
// can hold 3472 with stale code and silently poison the run.
const E2E_PORT = process.env.E2E_PORT ?? "3472";
const E2E_BASE = `http://127.0.0.1:${E2E_PORT}`;
export default defineConfig({
  testDir: "./tests-browser",
  timeout: 30_000,
  // one worker: specs seed the shared .e2e SQLite store and drive the same
  // server — parallel workers made the DB-backed specs flake under lock
  // contention (reproduced repeatedly with the content-search spec)
  workers: 1,
  use: {
    baseURL: E2E_BASE,
    headless: true,
  },
  webServer: {
    command: "npm --prefix .. run serve:test",
    url: `${E2E_BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
