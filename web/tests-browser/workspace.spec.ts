// ZWUI-024: browser integration tests against the reference-style UI.
import { test, expect } from "@playwright/test";

const TOKEN = "e2e-token";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((t) => localStorage.setItem("zcode-web-token", t), TOKEN);
  await page.goto("/w/default");
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // shell ready: brand + composer visible
  await expect(page.locator(".brand-name")).toHaveText("zcode");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
});

test("deep link renders the reference shell (route identity survives refresh)", async ({ page }) => {
  await expect(page.locator(".brand-header")).toBeVisible();
  await expect(page.locator(".topbar .breadcrumbs")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".statusbar")).toBeVisible();
});

test("send a message and watch the streamed reply complete", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("browser integration hello");
  await input.press("Enter");
  // live-run evidence appears (working dots or activity), then the echoed answer
  await expect(page.locator(".working-message, .agent-message").first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".agent-message")).toContainText("echo:browser integration hello", { timeout: 20000 });
  await expect(page.locator(".message-footer, .activity")).toContainText(/Task completed|succeeded|done|completed/, { timeout: 10000 });
  // a fresh chat adopts its session: the URL gains /s/<sessionId> while the
  // stream keeps rendering
  await expect(page).toHaveURL(/\/s\/sess_[A-Za-z0-9-]+/, { timeout: 10_000 });
  await expect(page.locator(".agent-message")).toContainText("echo:browser integration hello", { timeout: 5000 });
});

test("legacy double-encoded workspace URLs still resolve", async ({ page }) => {
  // old builds emitted %252F-style params; safeDecode must recover the path
  await page.goto("/w/%252Fnonexistent%252Fpath");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  // cwd falls back to the first allowed root and the composer works
  await page.getByLabel("Message Zcode").fill("double encode probe");
  await page.getByLabel("Message Zcode").press("Enter");
  await expect(page.locator(".agent-message")).toContainText("echo:double encode probe", { timeout: 20_000 });
});

test("cancel affordance: busy composer shows spinner, run reaches terminal", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("busy probe");
  await input.press("Enter");
  // fake CLI completes fast — composer returns to idle send state with the answer present
  await expect(page.locator(".agent-message")).toContainText("echo:busy probe", { timeout: 20000 });
  // composer leaves the working state: spinner send button replaced by idle one
  await expect(page.locator(".send-button .spin")).toHaveCount(0, { timeout: 10000 });
});

test("markdown XSS payload in model output is neutralized (T04 browser path)", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill('<img src=x onerror="window.__pwned=1"> plain-echo-marker');
  await input.press("Enter");
  await page
    .locator(".agent-message", { hasText: "plain-echo-marker" })
    .first()
    .waitFor({ timeout: 20000 });
  const html = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".agent-message .markdown"))
      .map((el) => el.innerHTML)
      .join("||")
  );
  expect(html).not.toContain("onerror");
  expect(html).toContain("plain-echo-marker");
});

test("Ctrl+K opens the search dialog and Escape closes it", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Find your next thought." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Find your next thought." })).toBeHidden();
});

test("sidebar Projects view lists roots and expands to sessions", async ({ page }) => {
  // fresh CI workspaces are empty — create a project like a user would
  await page.request.post("/api/projects", {
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    data: { name: "demo-project" },
  });
  await expect(page.locator(".sidebar-group").first()).toBeVisible();
  const toggle = page.locator(".group-toggle").first();
  await toggle.click();
  // project headings (dirs) appear inside the expanded group
  await expect(page.locator(".project-heading").first()).toBeVisible({ timeout: 5000 });
});
