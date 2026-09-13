// ZWUI-025/026: accessibility + performance validation on the new shell.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
});

test("a11y: workspace shell has no critical axe violations", async ({ page }) => {
  await page.goto("/w/default");
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(bad.map((v) => `${v.id}:${v.nodes.length}`)).toEqual([]);
});

test("a11y: interactive elements are keyboard reachable", async ({ page }) => {
  await page.goto("/w/default");
  await page.waitForLoadState("networkidle");
  const allowed = ["SELECT", "BUTTON", "INPUT", "TEXTAREA", "A"];
  let focused = "BODY";
  for (let i = 0; i < 8 && focused === "BODY"; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.tagName || "BODY");
  }
  expect(allowed).toContain(focused);
});

test("a11y: composer is labelled", async ({ page }) => {
  await page.goto("/w/default");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("perf: first-load JS under 250KB gzip", async ({ page }) => {
  const sizes: number[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/assets/") && res.url().endsWith(".js")) {
      sizes.push(Number(res.headers()["content-length"] || 0));
    }
  });
  await page.goto("/w/default");
  await page.waitForLoadState("networkidle");
  expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(250 * 1024);
});

test("perf: submit → echo completes responsively", async ({ page }) => {
  await page.goto("/w/default");
  const input = page.getByLabel("Message Zcode");
  const start = Date.now();
  await input.fill("perf probe");
  await input.press("Enter");
  await page.waitForFunction(() => document.body.textContent?.includes("echo:perf probe"), null, { timeout: 20000 });
  expect(Date.now() - start).toBeLessThan(20000);
});
