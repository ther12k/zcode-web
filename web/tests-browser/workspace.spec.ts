// ZWUI-024: browser integration tests against the reference-style UI.
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";

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
  await expect(page.locator(".message-footer, .activity")).toContainText(/Task completed|Plan ready|succeeded|done|completed/, { timeout: 10000 });
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

test("New chat during a pending fresh-chat run detaches it without hijack", async ({ page }) => {
  // "slowfirst" delays the run's first envelope: submit, then immediately
  // start a new chat while the run is still pending
  const input = page.getByLabel("Message Zcode");
  await input.fill("slowfirst pending probe");
  await input.press("Enter");
  await page.locator(".new-task-button").click();
  // the new chat must be free: empty state, and a typed composer can send
  await expect(page.getByRole("heading", { name: "Let's build something." })).toBeVisible({ timeout: 5000 });
  await input.fill("still free");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled({ timeout: 5000 });
  // when the detached run's envelope finally arrives it must NOT navigate
  // this view into its session or render its stream
  await page.waitForTimeout(6500);
  await expect(page).not.toHaveURL(/\/s\//);
  await expect(page.locator(".agent-message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
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

test("skills launcher lists real skills and drafts the composer", async ({ page }) => {
  await page.locator(".secondary-nav .nav-button", { hasText: "Skills" }).click();
  const dialog = page.getByRole("dialog", { name: /expertise, on demand/ });
  await expect(dialog).toBeVisible();
  // the fake CLI registry serves three skills
  await expect(dialog.locator(".skill-card")).toHaveCount(3);
  // search filters
  await dialog.getByLabel("Search skills").fill("deploy");
  await expect(dialog.locator(".skill-card")).toHaveCount(1);
  // selecting a skill lands its prompt in the composer and closes the dialog
  await dialog.locator(".skill-card").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Message Zcode")).toHaveValue("Use the fake-deploy skill: ");
});

test("sidebar Projects view lists roots and expands to sessions", async ({ page }) => {
  // Sessions is the default active view — switch to Projects explicitly
  await page.getByRole("tab", { name: "Projects" }).click();
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

test("search dialog opens on the latest sessions list", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Find your next thought." });
  await expect(dialog).toBeVisible();
  // empty query lists the most recent sessions across roots (503-free even
  // without a session DB — the list is just empty)
  await expect(dialog.locator(".search-results")).toBeVisible();
  await dialog.getByLabel("Search sessions").fill("zz-no-such-session");
  await expect(dialog.getByText("No matches. Yet.")).toBeVisible({ timeout: 5000 });
});

test("selecting a session shows a loader in the chat area", async ({ page }) => {
  // delay the transcript fetch so the loader state is observable
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: {}, transcript: [], total: 0, hasMore: false }),
    });
  });
  await page.goto("/w/default/s/sess_fake0000000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".chat-loader")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading conversation" })).toBeVisible();
  await expect(page.locator(".chat-loader")).toBeHidden({ timeout: 5000 });
});

test("timeline separators render like the desktop transcript", async ({ page }) => {
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {},
        transcript: [
          { role: "user", text: "hello", timeline: [] },
          {
            role: "user",
            text: "with a screenshot",
            files: [{ mime: "image/png", url: "", size: 1234, storageKind: "attachment", image: { height: 100, width: 200 } }],
          },
          {
            role: "assistant",
            text: "",
            timeline: [{ kind: "model_change", label: "Model changed", detail: "GLM-5.3 → gemini-3.8" }],
          },
          {
            role: "assistant",
            text: "answer body",
            timeline: [{ kind: "compaction", label: "Context compacted", detail: "196k → 5k tokens" }],
          },
          { role: "assistant", text: "", timeline: [{ kind: "session_fork", label: "Session forked", detail: "" }] },
          {
            role: "assistant",
            text: "",
            error: "[1308][Usage limit reached for 5 hour]",
            durationMs: 5391,
            tokens: 0,
          },
        ],
        total: 4,
        hasMore: false,
      }),
    });
  });
  await page.goto("/w/default/s/sess_tlsep00000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".chat-loader")).toBeHidden({ timeout: 5000 });
  // a hairline row per event, with the label and optional detail
  await expect(page.locator('.timeline-separator[data-kind="model_change"]')).toHaveText(/GLM-5.3 → gemini-3.8/);
  await expect(page.locator('.timeline-separator[data-kind="compaction"]')).toHaveText(/196k → 5k tokens/);
  await expect(page.locator('.timeline-separator[data-kind="session_fork"]')).toHaveCount(1);
  // a separator attached to a text turn renders inside that turn (its stack), not as a bare row
  await expect(page.locator(".timeline-stack .timeline-separator[data-kind=compaction]")).toHaveCount(1);
  await expect(page.getByText("answer body")).toBeVisible();
  // user-message attachments render as chips/thumbnails under the message
  await expect(page.locator(".user-message-block .file-cards")).toHaveCount(1);
  // failed turns: desktop-style footer, no raw error inline; detail is collapsed
  await expect(page.locator(".task-completed").last()).toHaveText(/Worked for 5s/);
  await expect(page.locator(".agent-message", { hasText: "answer body" }).locator(".danger-text")).toHaveCount(0);
  // raw error stays collapsed inside the details toggle
  await expect(page.getByText("Usage limit reached")).toBeHidden();
  await expect(page.locator(".turn-error summary")).toHaveCount(1);
});

test("an externally running session locks the composer and shows progress", async ({ page }) => {
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {},
        runActive: true,
        runStartedAt: Date.now() - 6500,
        transcript: [
          { role: "user", text: "keep going" },
          { role: "assistant", text: "", incomplete: true },
        ],
        total: 2,
        hasMore: false,
      }),
    });
  });
  await page.goto("/w/default/s/sess_runactive00000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".chat-loader")).toBeHidden({ timeout: 5000 });
  // progress row instead of a completed footer, and the send button spins
  await expect(page.locator(".external-working")).toContainText("Working");
  const send = page.locator(".send-button");
  await expect(send).toBeDisabled();
  await expect(send.locator("svg.spin")).toBeVisible();
  // desktop-style live elapsed timer on the working row
  await expect(page.locator(".working-elapsed")).toHaveText(/[0-9]+s/, { timeout: 4000 });
});

test("slash command palette: filter, execute local action, insert run-through", async ({ page }) => {
  await page.goto("/w/default");
  await page.waitForLoadState("domcontentloaded");
  const box = page.getByLabel("Message Zcode");
  await box.click();
  // typing "/" opens the palette with local + run-through entries
  await box.fill("/");
  const menu = page.locator(".command-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".command-name", { hasText: "/new" })).toBeVisible();
  await expect(menu.locator(".command-name", { hasText: "/compact" })).toBeVisible();
  // filtering narrows as you type
  await box.fill("/sea");
  await expect(menu.locator(".command-row")).toHaveCount(1);
  await expect(menu.locator(".command-name")).toHaveText("/search");
  // Enter executes the local action: the search dialog opens, input clears
  await box.press("Enter");
  await expect(page.getByRole("dialog", { name: "Find your next thought." })).toBeVisible();
  await expect(box).toHaveValue("");
  await page.keyboard.press("Escape");
  // custom commands from the (fake) registry are offered per workspace
  await box.click();
  await box.fill("/fake-");
  await expect(menu.locator(".command-name", { hasText: "/fake-ship" })).toBeVisible();
  await expect(menu.locator(".command-name", { hasText: "/fake-audit" })).toBeVisible();
  // Tab inserts a run-through command with a trailing space (args follow)
  await box.press("Tab");
  await expect(box).toHaveValue("/fake-ship ");
  await expect(menu).toBeHidden();
  // Escape dismisses the palette for the current draft
  await box.fill("/");
  await expect(menu).toBeVisible();
  await box.press("Escape");
  await expect(menu).toBeHidden();
});

test("deep-linked session shows its real title in the topbar", async ({ page }) => {
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: "sess_title0000000000000000000000000", title: "Probe: gate-out combo", directory: "/tmp/x", createdAt: 1, updatedAt: 2 },
        runActive: false,
        transcript: [{ role: "user", text: "hi" }],
        total: 1,
        hasMore: false,
      }),
    });
  });
  await page.goto("/w/default/s/sess_title0000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".chat-loader")).toBeHidden({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "Probe: gate-out combo" })).toBeVisible();
});

test("Sessions view scopes to the selected project, like the desktop", async ({ page }) => {
  const wsRoot = new URL("../../.e2e-ws", import.meta.url).pathname.replace(/\/$/, "");
  const roots: string[] = [];
  await page.route(/\/api\/sessions\/recent\?.*/, async (route) => {
    const url = new URL(route.request().url());
    roots.push(url.searchParams.get("root") || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [{ id: "sess_proj1", title: "project session", directory: wsRoot + "/proj", updatedAt: 1, createdAt: 1 }] }),
    });
  });
  // a nested workspace route — the query must target that folder, not the parent root
  roots.length = 0;
  await page.goto("/w/" + encodeURIComponent(wsRoot + "/proj"));
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("tab", { name: /Sessions/ }).click();
  await expect(page.getByText("project session")).toBeVisible();
  assert.ok(roots.length > 0, "sessions view queried the recent endpoint");
  for (const r of roots) assert.equal(r, wsRoot + "/proj", "query scoped to the project subtree, not the parent root");
});
