import pw from "../web/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = readFileSync(join(ROOT, ".env"), "utf8").match(/^ZCODE_WEB_TOKEN=(.+)$/m)[1].trim();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), TOKEN);
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.getByLabel("Message Zcode").waitFor({ timeout: 20000 });
const row = page.locator(".sessions-list .task-row").nth(1);
await row.hover();
await page.waitForTimeout(300);
const hit = await row.evaluate((el) => {
  const pin = el.querySelector(".task-pin");
  const r = pin.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const chain = [];
  let n = top;
  while (n && chain.length < 6) { chain.push(`${n.tagName}.${(n.className || "").toString().slice(0, 40)}`); n = n.parentElement; }
  const pinRect = pin.getBoundingClientRect();
  const arch = el.querySelector(".task-archive");
  return {
    pinCenter: { cx, cy },
    pinRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    archDisplay: arch ? getComputedStyle(arch).display : "none",
    archRect: arch ? arch.getBoundingClientRect().toJSON() : null,
    hitChain: chain,
    hitIsPin: pin === top || (top && pin.contains(top)),
  };
});
console.log(JSON.stringify(hit, null, 2));
await browser.close();
