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
  // app readiness before the shortcut — a cold server can otherwise eat the
  // keypress before the shell mounts its key handlers
  await expect(page.locator(".brand-name")).toHaveText("zcode");
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

// ZWUI-077: the desktop's goal card and "Worked for" figure, fed by real CLI
// store rows (session_target + turn_usage) through the session detail route.
test("goal card and worked-time chip render from real session_target/turn_usage rows", async ({ page }) => {
  mkdirSync(WS, { recursive: true });
  const dbDir = join(REPO, ".e2e-home", "cli", "db");
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "db.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
    CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE IF NOT EXISTS turn_usage (session_id TEXT, turn_id TEXT, user_message_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER);
    CREATE TABLE IF NOT EXISTS session_target (id TEXT PRIMARY KEY, session_id TEXT, objective TEXT, status TEXT, tokens_used INTEGER, time_used_seconds INTEGER, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE IF NOT EXISTS todo (session_id TEXT, content TEXT, status TEXT, priority TEXT, position INTEGER, time_created INTEGER, time_updated INTEGER, PRIMARY KEY (session_id, position));
  `);
  const sid = "sess_goal_e2e_00000000000000000000000000";
  // idempotent seed: the e2e store persists across runs and turn_usage has no
  // unique key — re-inserting would stack durations and skew "Worked for"
  db.prepare("DELETE FROM turn_usage WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM session_target WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM todo WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM part WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM message WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM session WHERE id = ?").run(sid);
  db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
    .run(sid, "Goal parity probe", WS, 1, Date.now());
  db.prepare("INSERT INTO message (id, session_id, data, sequence) VALUES (?,?,?,?)")
    .run("msg_goal_e2e", sid, JSON.stringify({ role: "user", time: { created: Date.now() } }), 0);
  db.prepare("INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?,?,?,?,?)")
    .run("part_goal_e2e", "msg_goal_e2e", sid, JSON.stringify({ type: "text", text: "work toward the goal" }), 0);
  db.prepare("INSERT INTO turn_usage (session_id, turn_id, user_message_id, status, started_at, completed_at, duration_ms) VALUES (?,?,?,?,?,?,?)")
    .run(sid, "t_goal_1", "msg_goal_e2e", "completed", 1, 2, 75_000);
  db.prepare("INSERT INTO session_target (id, session_id, objective, status, tokens_used, time_used_seconds, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?)")
    .run("target_goal_e2e", sid, "make this zcode web ui ux as close as possible to zcode desktop", "active", 318_822, 40_000, 1, Date.now());
  const insTodo = db.prepare("INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?,?,?,?,?,?,?)");
  insTodo.run(sid, "wire goal data through", "completed", "high", 0, 1, 1);
  insTodo.run(sid, "surface the progress list", "in_progress", "high", 1, 1, 2);
  insTodo.run(sid, "polish panel styles", "pending", "medium", 2, 1, 1);
  db.close();

  await page.goto("/w/" + encodeURIComponent(WS) + "/s/" + sid);
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  // the goal card (Overview tab of the inspector) shows the real objective
  // and cumulative time (stored 40_000s figure renders through the card)
  await page.getByLabel("Show preview panel").last().click();
  const goalPanel = page.locator(".goal-panel");
  await expect(goalPanel).toBeVisible();
  await expect(goalPanel).toContainText("make this zcode web ui ux as close as possible to zcode desktop");
  await expect(goalPanel).toContainText("In progress");
  // ZWUI-078: the agent's todo checklist renders as the desktop's Progress
  // list — count badge plus per-item status (done / active spinner / pending)
  const progress = page.locator(".progress-panel");
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("1/3");
  await expect(progress).toContainText("surface the progress list");
  await expect(progress.locator(".progress-item.is-completed")).toHaveCount(1);
  await expect(progress.locator(".progress-item.is-in_progress")).toHaveCount(1);
  await expect(progress.locator(".progress-item.is-pending")).toHaveCount(1);
  // ZWUI-081: the chat context strip's "Worked for" chip is a WORKING
  // indicator — hidden once no turn is running (the goal card and the
  // transcript's Completed summaries carry the record)
  await expect(page.locator(".worked-chip")).toHaveCount(0);
  // ZWUI-079: the topbar shows the same figure under the session title
  await expect(page.locator(".topbar-worked")).toContainText(/Worked for (1m|75s)/);
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
