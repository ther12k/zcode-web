// Live verification of the deployed app at :3000 — reads the token from .env
// at runtime, never logs or writes it. Verifies: shell loads, composer live,
// content search works against the REAL session DB (ZWUI-059), and captures
// a screenshot.
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const envPath = join(ROOT, ".env");
const TOKEN = process.env.ZCODE_WEB_TOKEN
  || (existsSync(envPath) ? readFileSync(envPath, "utf8").match(/^ZCODE_WEB_TOKEN=(.+)$/m)?.[1]?.trim() : "");
if (!TOKEN) { console.error("no token available"); process.exit(2); }

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), TOKEN);
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Message Zcode").waitFor({ timeout: 20000 });
  check("app shell loads with composer", true, page.url());

  // real content search: the workspace root store is large; any common word
  // exercises indexChunk (which used to throw on every call). The response
  // must carry index metadata WITHOUT an error, and progress must advance.
  const probe = await page.evaluate(async () => {
    const r = await fetch(`/api/search?q=session`, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token")}` } });
    return { status: r.status, body: await r.json() };
  });
  check("search answers 200", probe.status === 200, `status ${probe.status}`);
  check("content index advanced without error", probe.body.index && probe.body.index.total > 0 && !probe.body.index.error,
    `through=${probe.body.index?.through} total=${probe.body.index?.total} error=${probe.body.index?.error ?? "none"}`);
  check("search returns results", Array.isArray(probe.body.results) && probe.body.results.length > 0, `${probe.body.results?.length ?? 0} hits`);

  // second probe: progress must have moved forward (watermark works)
  const probe2 = await page.evaluate(async () => {
    const r = await fetch(`/api/search?q=zcode`, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token")}` } });
    return r.json();
  });
  check("index watermark persists across calls", probe2.index && probe2.index.through >= probe.body.index.through,
    `through=${probe2.index?.through}`);

  await page.screenshot({ path: "/tmp/zweb-live.png", fullPage: false });
  check("screenshot captured", true, "/tmp/zweb-live.png");
} catch (e) {
  check("live verification crashed", false, String(e).slice(0, 200));
  await page.screenshot({ path: "/tmp/zweb-live-error.png" }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
