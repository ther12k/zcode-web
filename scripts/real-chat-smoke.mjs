// ZWUI-058: REAL chat/explore smoke — runs genuine provider turns against a
// live deployment (real Z.AI/CLI, real session store). Opt-in, never part of
// CI: it consumes provider quota and touches the user's real workspace state.
//
// Usage:
//   node scripts/real-chat-smoke.mjs                       # http://localhost:3000
//   BASE_URL=https://host ZCODE_WEB_TOKEN=... node scripts/real-chat-smoke.mjs
//
// The token is read from ZCODE_WEB_TOKEN or parsed from .env (never logged,
// never committed — .env is gitignored).
//
// What it verifies, end to end, on the real stack:
//   1. new chat → real streamed reply (not the echo), elapsed-time byline
//   2. fresh-chat session adoption (/s/sess_… URL) while the reply streams
//   3. history persistence after reload — the sent message stays visible
//   4. follow-up turn in the SAME session (context continuation)
//   5. explore: the Files inspector tab lists real workspace files
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";

function loadToken() {
  if (process.env.ZCODE_WEB_TOKEN) return process.env.ZCODE_WEB_TOKEN;
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^ZCODE_WEB_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("No token: set ZCODE_WEB_TOKEN or keep .env beside the repo");
}
const TOKEN = loadToken();

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// A real turn can legitimately take a while (provider retries, mid-turn CLI
// auto-compaction): wait until the working indicator has been gone for a few
// consecutive polls before reading the reply.
async function waitForTurnIdle(page, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  while (Date.now() < deadline) {
    const working = await page.locator(".working-message, .agent-active").count();
    stable = working === 0 ? stable + 1 : 0;
    if (stable >= 3) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

async function sendAndWait(page, text) {
  const composer = page.getByLabel("Message Zcode");
  await composer.fill(text);
  await composer.press("Enter");
  await page.waitForSelector(".user-message-block.echo", { state: "detached", timeout: 180000 });
  await waitForTurnIdle(page);
  return (await page.locator(".agent-message").last().innerText()).trim();
}

// Small, cheap prompts: turn 1 forces a real file read; turn 2 needs turn 1's
// context, proving the session actually continued.
const T1 = 'Read the file "package.json" in this workspace and reply with ONLY the package name, nothing else.';
const T2 = "What exact text did I ask you for in my previous message? Reply with the quoted question only.";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => {
  window.localStorage.clear();
  window.localStorage.setItem("zcode-web-token", t); // bootstrap.ts TOKEN_KEY
}, TOKEN);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const composer = page.getByLabel("Message Zcode");
  await composer.waitFor({ timeout: 20000 });

  // ── turn 1: real chat with a real file read ─────────────────────────────
  await composer.fill(T1);
  await composer.press("Enter");
  await check("echo appears instantly", await page.waitForSelector(".user-message-block.echo", { timeout: 3000 }).then(() => true).catch(() => false));

  // live evidence: working dots, the running-byline, or activity while the provider thinks
  const liveSeen = await page
    .waitForSelector(".working-message, .working-elapsed, .activity-stack", { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("live-run evidence appears while streaming", liveSeen);

  // the REAL reply replaces the echo — require a plausible package name
  const reply = await sendAndWait(page, T1);
  check(
    "real streamed reply answers (package name)",
    /zcode[-_]?web|package/i.test(reply) && !reply.startsWith("echo:"),
    reply.slice(0, 80)
  );

  // fresh chat adopted its session id mid-run
  const url = page.url();
  check("session adoption URL", /\/s\/sess_[A-Za-z0-9-]+/.test(url), url);

  // ── history persistence: the user's past complaint — sent messages must
  //    still be visible in history after a reload ──────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Message Zcode").waitFor({ timeout: 20000 });
  const userTurns = await page.locator(".user-message-block .user-message").allInnerTexts();
  check("sent message visible in history after reload", userTurns.some((t) => t.includes("package.json")), `${userTurns.length} user turn(s)`);
  const historyReply = await page.locator(".agent-message").last().innerText({ timeout: 15000 });
  check("reply persisted in history", historyReply.trim().length > 0, historyReply.slice(0, 60));

  // ── turn 2: follow-up in the SAME session (context continuation) ────────
  let reply2 = await sendAndWait(page, T2);
  // the provider occasionally flakes on a second request ("Model request
  // failed"); ONE honest retry before calling it a failure
  if (/failed/i.test(reply2) && reply2.length < 400) {
    console.log("      (provider flake — retrying turn 2 once)");
    reply2 = await sendAndWait(page, T2);
  }
  check(
    "follow-up proves shared context (quotes turn 1)",
    /package\.json|package name|read/i.test(reply2),
    reply2.slice(0, 80)
  );

  // ── explore: the Files inspector tab reads real workspace files ─────────
  const showPanel = page.getByLabel("Show preview panel").last();
  if (await showPanel.isVisible().catch(() => false)) await showPanel.click();
  const filesTab = page.getByRole("tab", { name: "Files" });
  await filesTab.click({ timeout: 5000 }).catch(async () => {
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByText("Browse files").click();
  });
  await page.waitForSelector(".preview-panel .code-panel", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500); // real file listing round-trip
  const fileRows = await page.locator(".preview-panel .file-tabs button").count();
  const bodyText = await page.locator(".preview-panel").innerText().catch(() => "");
  check(
    "Files tab lists real workspace entries",
    fileRows > 0 || /package\.json|src|server/i.test(bodyText),
    `${fileRows} file rows`
  );
} catch (err) {
  check("smoke run crashed", false, String(err).slice(0, 300));
} finally {
  await page.screenshot({ path: "/tmp/real-chat-smoke-last.png", fullPage: false }).catch(() => {});
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
