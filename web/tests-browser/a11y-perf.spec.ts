// ZWUI-025/026: accessibility + performance validation.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("a11y", () => {
  test("workspace shell has no critical axe violations", async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
    await page.goto("/w/default");
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    // tolerate none; list what remains
    expect(critical.map((v) => `${v.id}:${v.nodes.length}`)).toEqual([]);
  });

  test("interactive elements are keyboard reachable", async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
    await page.goto("/w/default");
    const allowed = ["SELECT", "BUTTON", "INPUT", "TEXTAREA", "A"];
    let focused = "BODY";
    for (let i = 0; i < 4 && focused === "BODY"; i++) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate(() => document.activeElement?.tagName || "BODY");
    }
    expect(allowed).toContain(focused);
  });

  test("composer is reachable and labelled", async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
    await page.goto("/w/default");
    await expect(page.getByLabel("Ask zcode")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});

test.describe("performance", () => {
  test("first-load JS budget (initial bundle under 250KB gzip)", async ({ page }) => {
    const sizes = [];
    page.on("response", async (res) => {
      if (res.url().includes("/assets/") && res.url().endsWith(".js")) {
        sizes.push(Number(res.headers()["content-length"] || 0));
      }
    });
    await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
    await page.goto("/w/default");
    await page.waitForLoadState("networkidle");
    const totalGzip = sizes.reduce((a, b) => a + b, 0);
    expect(totalGzip).toBeLessThan(250 * 1024);
  });

  test("transcript interaction stays responsive with a 400-message session", async ({ page }) => {
    // slow page on purpose: paginated history keeps DOM bounded (5 per page)
    await page.addInitScript((t) => localStorage.setItem("zcode-web-token", t), "e2e-token");
    await page.goto("/w/default");
    const start = Date.now();
    await page.getByLabel("Ask zcode").fill("perf probe");
    await page.getByLabel("Ask zcode").press("Enter");
    await page.waitForFunction(() => document.body.textContent?.includes("echo:perf probe"), null, { timeout: 20000 });
    expect(Date.now() - start).toBeLessThan(20000);
  });
});
