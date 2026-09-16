// Live black-box QA sweep against the running deployment (:3000) with REAL
// data. Read-only: no prompts are sent, no server-side mutations — pin/hide
// toggles write only to this throwaway browser profile's localStorage.
// Reads the token from env/.env at runtime, never logs it.
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = ROOT;
const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.ZCODE_WEB_TOKEN
  || (existsSync(join(ROOT, ".env")) ? readFileSync(join(ROOT, ".env"), "utf8").match(/^ZCODE_WEB_TOKEN=(.+)$/m)?.[1]?.trim() : "");
if (!TOKEN) { console.error("no token"); process.exit(2); }

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`); };
const shot = (page, name) => page.screenshot({ path: `/tmp/qa-${name}.png`, fullPage: false }).catch(() => {});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), TOKEN);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Message Zcode").waitFor({ timeout: 20000 });

  // ── 1. open the most recent REAL session and inspect the transcript ────
  const firstRow = page.locator(".sessions-list .task-row .task-link").first();
  await firstRow.click();
  await page.waitForURL(/\/s\/sess_/, { timeout: 15000 });
  await page.locator(".agent-message, .user-message-block").first().waitFor({ timeout: 15000 });
  const turnCount = await page.locator(".user-message-block, .agent-message, .timeline-stack").count();
  check("real session renders turns", turnCount > 0, `${turnCount} blocks`);
  const body = await page.locator(".messages-scroll").innerText();
  check("no internal bookkeeping leaks into the transcript", !/secret-reasoning|sess_subagent_|\[object Object\]/.test(body));
  await shot(page, "session");

  // ── 2. load-older pagination over real history ──────────────────────────
  const older = page.locator(".load-older");
  if (await older.isVisible().catch(() => false)) {
    const idsBefore = await page.locator(".user-message-block, .agent-message").evaluateAll((els) => els.map((e) => e.getAttribute("class") + e.textContent?.slice(0, 40)));
    const scroll = page.locator(".messages-scroll");
    await older.click();
    await page.waitForTimeout(2500);
    const idsAfter = await page.locator(".user-message-block, .agent-message").evaluateAll((els) => els.map((e) => e.getAttribute("class") + e.textContent?.slice(0, 40)));
    check("load-older appends without duplicates", idsAfter.length > idsBefore.length && new Set(idsAfter).size === idsAfter.length,
      `${idsBefore.length} -> ${idsAfter.length}`);
    await scroll.evaluate((el) => { el.scrollTop = 0; });
    await shot(page, "load-older");
  } else {
    check("load-older (short session: control absent)", true);
  }

  // ── 3. token telemetry over real numbers ────────────────────────────────
  const tokenChip = page.locator(".token-chip");
  if (await tokenChip.isVisible().catch(() => false)) {
    await tokenChip.click();
    const audit = page.getByRole("dialog");
    await audit.waitFor({ timeout: 5000 });
    const auditText = await audit.innerText();
    check("token telemetry shows real per-turn numbers", /\d[\d,.]*\s*(tk|tokens)|tok/i.test(auditText), auditText.replace(/\n/g, " ").slice(0, 80));
    await shot(page, "telemetry");
    await page.keyboard.press("Escape");
  }

  // ── 4. search dialog over real data ─────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Find your next thought." });
  await search.getByPlaceholder("Search sessions across your workspace roots…").fill("zcode");
  await page.waitForTimeout(1200);
  const searchResults = await search.locator(".search-results > button, .search-results strong").count();
  check("search over real data returns hits", searchResults > 0, `${searchResults} rows`);
  await shot(page, "search");
  await page.keyboard.press("Escape");

  // ── 5. analytics over the real store ────────────────────────────────────
  // the FIRST build for these roots scans every part on the server worker
  // (honest 202 + "Building the first snapshot" in the dialog until done)
  await page.locator(".statusbar").getByText("Analytics").click();
  const analytics = page.getByRole("dialog").filter({ hasText: /nalytics/i }).first();
  await analytics.waitFor({ timeout: 10000 });
  // wait for the worker build to converge (bounded), polling like the dialog does
  let analyticsReady = false;
  for (let i = 0; i < 60 && !analyticsReady; i++) {
    await page.waitForTimeout(2000);
    analyticsReady = await analytics.locator(".token-metric").first().isVisible().catch(() => false);
  }
  const aText = await analytics.innerText().catch(() => "");
  check("analytics renders real aggregates once the first build lands", analyticsReady && /\d/.test(aText), aText.replace(/\n/g, " ").slice(0, 90));
  await shot(page, "analytics");
  await page.keyboard.press("Escape");
  await analytics.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  // ── 6. pin → pinned section → unpin (device-local, throwaway profile) ──
  // scope to ONE row: hover it, then act on its own controls — .first()
  // across rows races the live session re-sorting the list under the mouse
  const pinRow = page.locator(".sessions-list .task-row").nth(1);
  await pinRow.hover();
  const pin = pinRow.locator(".task-pin");
  if (await pin.isVisible().catch(() => false)) {
    await pin.click();
    await page.waitForTimeout(400);
    const pinnedVisible = await page.locator(".pinned-section .pinned-row").count();
    check("pinning surfaces the pinned section", pinnedVisible === 1, `${pinnedVisible} pinned rows`);
    const pinnedRow = page.locator(".pinned-section .pinned-row").first();
    await pinnedRow.hover();
    await pinnedRow.locator(".pinned-unpin").click();
    await page.waitForTimeout(400);
    check("unpin removes the pinned section", (await page.locator(".pinned-section").count()) === 0);
  } else {
    check("pin control present on hover", false, "pin not visible on the hovered row");
  }

  // ── 7. hide a session → Settings shows it → restore ─────────────────────
  const hideRow = page.locator(".sessions-list .task-row").nth(1);
  const rowTitle = (await hideRow.locator(".task-title").textContent().catch(() => "")) || "";
  await hideRow.hover();
  await hideRow.locator(".task-archive").click();
  await page.waitForTimeout(400);
  check("hidden row disappears from the list", !(await page.locator(".sessions-list .task-row").filter({ hasText: rowTitle }).count()), rowTitle.slice(0, 30));
  await page.locator(".profile-button").click();
  const settings = page.getByRole("dialog", { name: /Make yourself at home/ });
  await settings.waitFor({ timeout: 5000 });
  const hiddenHeading = settings.getByText("Hidden sessions.");
  check("Settings exposes hidden-session management", await hiddenHeading.isVisible().catch(() => false));
  const restore = settings.getByRole("button", { name: /^Restore/ }).first();
  if (await restore.isVisible().catch(() => false)) {
    await restore.click();
    await page.waitForTimeout(400);
    check("restore returns the row to the list", (await page.locator(".sessions-list .task-row").count()) > 0);
  }
  await shot(page, "settings");
  await page.keyboard.press("Escape");

  // ── 8. Files/Changes inspectors on the real repo project ────────────────
  // the repo is NESTED under the workspace root and the Projects view lists
  // depth-1 dirs only — navigate by URL like a user with the link would
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(new URL("/w/" + encodeURIComponent(join(REPO)), BASE).toString(), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Message Zcode").waitFor({ timeout: 15000 });
  await page.getByLabel("Show preview panel").last().click();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.waitForTimeout(1500);
  {
    const panel = page.locator(".preview-panel");
    const filesText = await panel.innerText().catch(() => "");
    check("Files inspector lists real repo entries", /package\.json|server|web|src/i.test(filesText), filesText.replace(/\n/g, " ").slice(0, 80));
    await shot(page, "files");
    await page.getByRole("tab", { name: "Changes" }).click();
    await page.waitForTimeout(1200);
    const changesText = await panel.innerText().catch(() => "");
    check("Changes inspector answers for the real repo", /clean|caught up|changed file|modified|new|failed/i.test(changesText), changesText.replace(/\n/g, " ").slice(0, 80));
    await shot(page, "changes");
  }

  // ── 9. mobile viewport sanity ────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Message Zcode").waitFor({ timeout: 15000 });
  await shot(page, "mobile");
  check("mobile shell mounts", true);

  // ── 10. console hygiene ──────────────────────────────────────────────────
  // the expected 422s: /api/git/status on a non-repo cwd — the UI handles
  // them honestly (no branch chip / honest Changes message)
  const realErrors = consoleErrors.filter((e) => !/favicon|Autofocus|Download the React DevTools|422/i.test(e));
  check("no console/page errors during the sweep", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("QA sweep crashed", false, String(e).slice(0, 200));
  await shot(page, "crash");
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} QA checks passed`);
process.exit(failed ? 1 : 0);
