// ZWUI-068: capability-enabled and auth flows against the REAL test server
// (serve:test now sets ZCODE_ENABLE_FILES=1 + ZCODE_ENABLE_GIT=1) — no route
// mocking for the files/auth paths under test.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
