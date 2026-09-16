// ZWUI-068: capability-enabled and auth flows against the REAL test server
// (serve:test now sets ZCODE_ENABLE_FILES=1 + ZCODE_ENABLE_GIT=1) — no route
// mocking for the files/auth paths under test.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WS = join(REPO, ".e2e-ws");

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
});

test("files inspector lists real workspace files (capability enabled)", async ({ page }) => {
  mkdirSync(WS, { recursive: true });
  const marker = `capabilities-marker-${Date.now()}.txt`;
  writeFileSync(join(WS, marker), "capability fixture payload");
  try {
    await page.goto("/w/" + encodeURIComponent(WS));
    await expect(page.getByLabel("Message Zcode")).toBeVisible();
    await page.getByLabel("Show preview panel").last().click();
    await page.getByRole("tab", { name: "Files" }).click();
    const browse = page.getByText("Browse files");
    if (await browse.isVisible().catch(() => false)) await browse.click();
    // the real listing includes the file this test just created
    await expect(page.locator(".preview-panel .code-panel")).toBeVisible();
    await expect(page.locator(".preview-panel")).toContainText(marker);
    // opening it renders its real content through the files API
    await page.locator(".preview-panel .file-tabs button", { hasText: marker }).first().click();
    await expect(page.locator(".preview-panel")).toContainText("capability fixture payload");
  } finally {
    rmSync(join(WS, marker), { force: true });
  }
});

test("changes tab decodes git status codes into words", async ({ page }) => {
  await page.route(/\/api\/git\/status.*/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        branch: "main",
        entries: [
          { path: "src/app.ts", status: "M " },
          { path: "notes.txt", status: "??" },
          { path: "src/util.ts", status: "MM" },
        ],
      }),
    })
  );
  await page.goto("/w/" + encodeURIComponent(WS));
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  await page.getByLabel("Show preview panel").last().click();
  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.locator(".diff-file-header")).toHaveCount(3);
  // words, never raw two-letter codes; screen readers get the long form
  await expect(page.locator(".diff-file-header", { hasText: "src/app.ts" }).locator(".file-state")).toHaveText("modified");
  await expect(page.locator(".diff-file-header", { hasText: "notes.txt" }).locator(".file-state")).toHaveText("new");
  await expect(page.locator(".diff-file-header", { hasText: "src/util.ts" }).locator(".file-state")).toHaveText("modified");
});

test("auth: token prompt appears without storage and accepts a correct token via UI", async ({ page }) => {
  // this test needs NO stored token — clear what the file-level init set
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Access token" });
  await expect(input).toBeVisible();
  await input.fill("definitely-wrong-token");
  await page.getByRole("button", { name: "Unlock" }).click();
  // the server rejects it: the prompt says so (401 → authState unauthorized)
  await expect(page.getByText(/token didn't take|Check it against/i).first()).toBeVisible({ timeout: 10_000 });
  await input.fill("e2e-token");
  await page.getByRole("button", { name: /Try again|Unlock/ }).click();
  await expect(page.getByLabel("Message Zcode")).toBeVisible({ timeout: 15_000 });
});

// ZWUI-059/068 end-to-end: content search must find a needle that exists
// ONLY in a message body (never in the title), through the real sidecar
// FTS index — this is the path that was broken before the bind fix.
test("search finds message content through the sidecar index", async ({ page }) => {
  // seed the CLI store the way the server reads it: one session under the
  // e2e workspace root whose TEXT carries the needle
  mkdirSync(WS, { recursive: true });
  const dbDir = join(REPO, ".e2e-home", "cli", "db");
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "db.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
    CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
  `);
  db.prepare("INSERT OR REPLACE INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
    .run("sess_search_content_e2e", "Totally bland title", WS, 1, Date.now());
  db.prepare("INSERT OR REPLACE INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)")
    .run("msg_search_content_e2e", "sess_search_content_e2e", JSON.stringify({ role: "assistant" }), 0);
  db.prepare("INSERT OR REPLACE INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)")
    .run("part_search_content_e2e", "msg_search_content_e2e", "sess_search_content_e2e", JSON.stringify({ type: "text", text: "the zephyr-quokka-cache needle is buried in the body" }), 0);
  db.close();

  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Find your next thought." });
  await expect(dialog).toBeVisible();
  // a query that matches NEITHER the title NOR any session id — only the
  // indexed body text can answer it (≥3 chars triggers the content index)
  await dialog.getByPlaceholder("Search sessions across your workspace roots…").fill("zephyr-quokka-cache");
  await expect(dialog.locator(".search-results").first()).toContainText("Totally bland title", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

// ZWUI-066: stacked overlays — the TOPMOST one owns Escape. With a preview
// open and the search dialog stacked above it, one Escape closes only the
// search; the preview underneath survives until its own Escape.
test("Escape closes only the topmost overlay (stacked dialogs)", async ({ page }) => {
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: "sess_stack000000000000000000000000000", title: "stack", directory: WS },
        transcript: [
          {
            role: "user",
            text: "with an attachment",
            files: [{ mime: "text/plain", url: "/tmp/notes-stack.txt", size: 42, storageKind: "attachment", image: null }],
          },
        ],
        total: 1,
        hasMore: false,
      }),
    });
  });
  await page.route(/\/api\/files\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: "stacked overlay fixture" }) });
  });
  await page.goto("/w/" + encodeURIComponent(WS) + "/s/sess_stack000000000000000000000000000");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  // open the preview overlay (bottom layer)
  await page.locator(".file-card").first().click();
  const preview = page.getByRole("dialog", { name: /Preview/ });
  await expect(preview).toBeVisible();
  // stack the search dialog above it
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Find your next thought." });
  await expect(search).toBeVisible();
  // ONE Escape closes ONLY the topmost (search); the preview survives
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(preview).toBeVisible();
  // the next Escape is finally the preview's
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
});
