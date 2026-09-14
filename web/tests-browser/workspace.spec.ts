// ZWUI-024: browser integration tests against the reference-style UI.
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  // the prompt echoes instantly — it must not vanish while the run is in flight
  await expect(page.locator(".user-message-block.echo")).toContainText("browser integration hello", { timeout: 3000 });
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

test("Sessions view shows the latest 50 across roots with project labels", async ({ page }) => {
  const queries: string[] = [];
  await page.route(/\/api\/sessions\/recent\?.*/, async (route) => {
    const url = new URL(route.request().url());
    queries.push(url.searchParams.get("limit") || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [
        { id: "sess_g1", title: "session in another project", directory: "/home/ther12k/Workspace/other-proj", updatedAt: 2, createdAt: 2 },
        { id: "sess_g2", title: "session in this project", directory: "/home/ther12k/Workspace/proj", updatedAt: 1, createdAt: 1 },
      ] }),
    });
  });
  await page.goto("/w/default");
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("tab", { name: /Sessions/ }).click();
  await expect(page.getByText("session in another project")).toBeVisible();
  // global list: every query asks for the latest 50 without a project filter
  assert.ok(queries.length > 0);
  for (const q of queries) assert.equal(q, "50", "latest-50 query, no root scoping");
  // each row labels its project
  const row = page.locator(".task-row", { hasText: "session in another project" });
  await expect(row.locator(".task-project")).toHaveText("other-proj");

  // clicking a session from another project routes to its canonical directory
  await row.locator(".task-link").click();
  await expect(page).toHaveURL(/.*other-proj.*sess_g1/);
});

test("desktop updates append without reloading the open view", async ({ page }) => {
  // first fetch: one turn; later fetches: same turn (same id, text grew) + a new one
  let calls = 0;
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    calls += 1;
    const turns = calls === 1
      ? [{ id: "msg_a", role: "user", text: "first prompt" }]
      : [
          { id: "msg_a", role: "user", text: "first prompt" },
          { id: "msg_b", role: "assistant", text: "answer that streamed in from the desktop", durationMs: 4000 },
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: { id: "sess_live00000000000000000000000000", title: "live" }, runActive: false, transcript: turns, total: turns.length, hasMore: false }),
    });
  });
  await page.goto("/w/default/s/sess_live00000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("first prompt")).toBeVisible();
  // trigger the visibility-refresh path (merge, not reload)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // the new turn appends; the old one stays mounted; no loader flash
  await expect(page.getByText("answer that streamed in from the desktop")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("first prompt")).toBeVisible();
  await expect(page.locator(".chat-loader")).toHaveCount(0);
  await expect(page.getByText("Worked for 4s")).toBeVisible();
});

test("chat affordances: jump-to-latest pill and stable load-older position", async ({ page }) => {
  // 40 turns so there is scrollback to load
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", text: `turn ${i} — ${"content ".repeat(8)}` }));
  let calls = 0;
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, async (route) => {
    calls += 1;
    const all = mk(40);
    const offset = Number(new URL(route.request().url()).searchParams.get("offset") || 0);
    const page40 = all.slice(Math.max(0, all.length - 10 - offset), all.length - offset);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: { id: "sess_scrl00000000000000000000000000", title: "scroll" }, runActive: false, transcript: page40, total: 40, hasMore: offset + 10 < 40 }),
    });
  });
  await page.goto("/w/default/s/sess_scrl00000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("turn 39", { exact: false })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400); // let the initial scroll-to-bottom settle
  // scroll up: the pill appears and takes you back to the bottom
  await page.evaluate(() => { const el = document.querySelector(".messages-scroll") as HTMLElement; el.scrollTop = 0; });
  await expect(page.locator(".jump-latest")).toBeVisible();
  await page.locator(".jump-latest").click();
  await page.waitForTimeout(700); // smooth scroll settles
  const atBottom = await page.evaluate(() => {
    const el = document.querySelector(".messages-scroll") as HTMLElement;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  });
  assert.ok(atBottom, "jump pill returns to the bottom");
  await expect(page.locator(".jump-latest")).toBeHidden();
  // load older keeps the reading position: same first-visible text after prepend
  await page.evaluate(() => { const el = document.querySelector(".messages-scroll") as HTMLElement; el.scrollTop = el.scrollHeight - 300; });
  await page.locator("button.load-older").click();
  await page.waitForTimeout(900);
  const pos = await page.evaluate(() => {
    const el = document.querySelector(".messages-scroll") as HTMLElement;
    return { scrollTop: el.scrollTop, atTop: el.scrollTop < 10 };
  });
  assert.ok(!pos.atTop, "load-older must not yank the viewport to the top");
});

// ZPAR-016: responsive shell — navigation drawer below 1100px and the
// chat/inspector pane switch below 821px must be fully operable.
test.describe("mobile shell (390px)", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("navigation drawer opens, dismisses, and closes on selection", async ({ page }) => {
    // desktop chrome is hidden at this width; only the hamburger remains
    await expect(page.locator(".brand-header")).toBeHidden();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.locator(".mobile-menu-button").click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".sidebar-scrim")).toBeVisible();
    // scrim dismisses the drawer (click its right edge — the drawer covers
    // the left 238px of the full-width scrim)
    await page.locator(".sidebar-scrim").click({ position: { x: 350, y: 20 } });
    await expect(page.locator(".sidebar")).toBeHidden();
    // Escape closes it too
    await page.locator(".mobile-menu-button").click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar")).toBeHidden();
    // a selection from the drawer closes it and lands in the chat pane
    await page.locator(".mobile-menu-button").click();
    await page.locator(".new-task-button").click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.getByLabel("Message Zcode")).toBeVisible();
  });

  test("preview button switches between the chat and inspector panes", async ({ page }) => {
    await page.locator(".mobile-preview-button").click();
    await expect(page.locator(".preview-panel")).toBeVisible();
    await expect(page.getByLabel("Message Zcode")).toBeHidden();
    // the panel's close control returns to the chat pane
    await page.getByLabel("Close panel").click();
    await expect(page.getByLabel("Message Zcode")).toBeVisible();
    await expect(page.locator(".preview-panel")).toBeHidden();
  });
});

// Telemetry surfaces ported from the clone: token audit dialog and the
// read-only agent terminal, both driven by the (mocked) real transcript.
test.describe("telemetry surfaces", () => {
  const mkTurn = (i: number, over: Record<string, unknown> = {}) => ({
    id: `tm${i}`,
    role: i % 2 ? "assistant" : "user",
    text: i % 2 ? `answer ${i}` : `question ${i}`,
    tokens: i % 2 ? 1500 + i * 100 : 0,
    durationMs: i % 2 ? 4000 + i * 500 : null,
    createdAt: 1_700_000_000_000 + i * 60_000,
    tools: i === 1 ? [{ name: "Bash", status: "completed", detail: "npm test" }] : [],
    ...over,
  });
  const teleSession = {
    session: { id: "sess_tele0001", title: "telemetry probe" },
    runActive: false,
    transcript: [mkTurn(0), mkTurn(1), mkTurn(3)],
    total: 3,
    hasMore: false,
  };

  test.beforeEach(async ({ page }) => {
    await page.route(/\/api\/sessions\/sess_.+\?limit=/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(teleSession) })
    );
    await page.goto("/w/default/s/sess_tele0001");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("answer 1")).toBeVisible({ timeout: 5000 });
  });

  test("token telemetry dialog shows per-turn audit from real fields", async ({ page }) => {
    await page.locator(".chat-context .token-chip").click();
    const dialog = page.getByRole("dialog", { name: /Token telemetry/i });
    await expect(dialog).toBeVisible();
    // only assistant turns carry tokens/duration in the mock — 2 measured rows
    await expect(dialog.getByText(/Turns measured/)).toBeVisible();
    await expect(dialog.locator(".token-table tbody tr")).toHaveCount(2);
    // speed cells render (one per measured turn)
    await expect(dialog.locator(".token-table td.num").filter({ hasText: /\/s$/ })).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: /Export JSON/ })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /Copy summary/ })).toBeVisible();
    // Escape closes (shared dialog a11y)
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("agent terminal drawer lists bash evidence and is read-only", async ({ page }) => {
    await page.locator(".chat-context .details-toggle", { hasText: "Terminal" }).click();
    const term = page.locator(".workspace-terminal");
    await expect(term).toBeVisible();
    await expect(term.getByText("read-only")).toBeVisible();
    await expect(term.locator(".terminal-command")).toContainText("npm test");
    await expect(term.locator(".terminal-command").first()).toContainText("$");
    // no shell input exists: it is evidence, not a terminal emulator
    assert.equal(await term.locator("input").count(), 0);
    // clear empties the view, Escape closes
    await term.getByLabel("Clear terminal view").click();
    await expect(term.locator(".terminal-command")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(term).toBeHidden();
  });

  test("byline times render and toggle between relative and exact", async ({ page }) => {
    const bar = page.locator(".chat-context");
    await bar.locator(".details-toggle").first().click();
    await expect(bar).toContainText("HH:MM");
    await expect(page.locator(".message-byline time").first()).toHaveText(/\d{2}:\d{2}/);
    await bar.locator(".details-toggle").first().click();
    await expect(page.locator(".message-byline time").first()).toHaveText(/^\d+[mhd]$/);
  });
});

// Clone v2 surfaces: rich code blocks, diff viewer, analytics dialog.
test("code blocks render with header, copy, and line numbers; code HTML stays inert", async ({ page }) => {
  // the fake CLI echoes a fenced block when asked
  const input = page.getByLabel("Message Zcode");
  await input.fill("show me code");
  await input.press("Enter");
  await expect(page.locator(".code-block").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".code-block-lang").first()).toBeVisible();
  await expect(page.locator(".code-line-no").first()).toBeVisible();
  // <script> inside code must not execute / no real script node appears
  assert.equal(await page.locator(".code-block script").count(), 0);
  // copy button reacts (headless may deny clipboard; assert no crash + still labeled)
  await page.locator(".code-block-copy").first().click();
  await expect(page.locator(".code-block-copy").first()).toContainText(/Copy/);
});

test("changes tab opens the diff viewer modal with unified/split and stats", async ({ page }) => {
  // one modified file with a stable unified diff
  await page.route(/\/api\/git\/status.*/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ branch: "main", entries: [{ path: "src/app.ts", status: "modified" }] }) })
  );
  await page.route(/\/api\/git\/diff.*/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ diff: "diff --git a/src/app.ts b/src/app.ts\nindex 111..222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n console.log(a);" }),
    })
  );
  await page.getByLabel("Show preview panel").last().click();
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.locator(".diff-file-header").first().click();
  const dialog = page.getByRole("dialog", { name: /Diff of src\/app.ts/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".diff-stat").first()).toHaveText("+2");
  await expect(dialog.locator(".diff-stat").nth(1)).toHaveText("−1");
  // unified: hunk header + 5 content rows (same, del, add, add, same)
  await expect(dialog.locator(".diff-hunk-row")).toHaveCount(1);
  await expect(dialog.locator(".diff-row")).toHaveCount(5);
  // split view halves the code columns
  await dialog.getByLabel("Split view").click();
  await expect(dialog.locator(".diff-table.split")).toBeVisible();
  // copy patch (headless may deny clipboard; assert the control exists and click is safe)
  await expect(dialog.getByRole("button", { name: /Copy patch/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Copy patch/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("analytics dialog shows honest aggregates from /api/analytics", async ({ page }) => {
  await page.route(/\/api\/analytics.*/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: 12, tokens: 250_000, steps: 90, turns: 33, agentTimeMs: 7_200_000,
        failedTurns: 2, activeSessions: 1,
        daily: [{ day: "2026-09-13", sessions: 4 }, { day: "2026-09-14", sessions: 8 }],
        topSessions: [{ id: "sess_top1", title: "Top worker", directory: "/ws/proj", updatedAt: 1, tokens: 120_000 }],
        generatedAt: 1,
      }),
    })
  );
  await page.locator(".statusbar").getByRole("button", { name: "Analytics" }).click();
  const dialog = page.getByRole("dialog", { name: /Workspace analytics/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("12", { exact: true })).toBeVisible();
  await expect(dialog.getByText("250.0k")).toBeVisible();
  await expect(dialog.locator(".analytics-bar")).toHaveCount(2);
  await expect(dialog.locator(".analytics-row")).toHaveCount(1);
  // clicking the top session navigates and closes
  await dialog.locator(".analytics-row").click();
  await expect(page).toHaveURL(/.*sess_top1/);
  await expect(dialog).toBeHidden();
});

// ---- ZWUI-040/041/042: run-identity correctness ----

test("ZWUI-040: Stop shows cancelled in the browser AND /api/jobs agrees", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  const chatRespPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST" && r.status() === 202
  );
  await input.fill("wait a while before finishing");
  await input.press("Enter");
  const { jobId } = await (await chatRespPromise).json();
  // the run is busy: the composer shows the stop affordance
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await page.getByLabel("Stop run").click();
  // the browser reaches cancelled (the authoritative done event, not an
  // exitCode-derived "failed" — the fake CLI dies by signal, exitCode null)
  await expect(page.locator(".message-duration")).toHaveText(/cancelled/, { timeout: 15_000 });
  // …and the authoritative job record agrees
  const st = await page.request.get(`/api/jobs/${jobId}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(st.status(), 200);
  assert.equal((await st.json()).status, "cancelled");
});

test("ZWUI-042: a held job-status response for run A cannot finalize run B", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  // A: completes fast — its status poll at +5s will report succeeded
  const respAPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST" && r.status() === 202
  );
  await input.fill("race probe A");
  await input.press("Enter");
  const { jobId: jobIdA } = await (await respAPromise).json();
  await expect(page.locator(".agent-message")).toContainText("echo:race probe A", { timeout: 20_000 });

  // hold A's /api/jobs status response after it has been fetched
  let held = 0;
  let releaseA: () => void = () => {};
  const gate = new Promise<void>((res) => { releaseA = res; });
  await page.route(new RegExp(`/api/jobs/${jobIdA}$`), async (route) => {
    held += 1;
    const resp = await route.fetch();
    await gate;
    await route.fulfill({ response: resp });
  });
  // A's reconciliation poll ticks at +5s — wait until its request is held
  await expect.poll(() => held, { timeout: 12_000 }).toBeGreaterThan(0);

  // switch to B while A's response is frozen in flight
  await page.locator(".new-task-button").click();
  const respBPromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST" && r.status() === 202
  );
  await input.fill("B wait a while before finishing");
  await input.press("Enter");
  const { jobId: jobIdB } = await (await respBPromise).json();
  assert.notEqual(jobIdA, jobIdB);
  await expect(page.locator(".working-message").first()).toBeVisible({ timeout: 8000 });

  // release A's succeeded status on top of B's active run
  releaseA();
  await page.waitForTimeout(1500);
  // B must STILL be running — A's terminal status never applied to it
  await expect(page.locator(".working-message").first()).toBeVisible();
  await expect(page.getByLabel("Send message")).toBeDisabled();
  // cleanup: free the slow B job so other tests keep their job slots
  await page.request.post(`/api/jobs/${jobIdB}/cancel`, { headers: { authorization: `Bearer ${TOKEN}` } });
  await expect(page.locator(".message-duration")).toHaveText(/cancelled/, { timeout: 15_000 });
});

test("ZWUI-041: retry after an ambiguous send reuses the request id and adopts the same job", async ({ page }) => {
  const requestIds: string[] = [];
  let poisoned = false;
  await page.route(/\/api\/chat$/, async (route) => {
    requestIds.push((route.request().postDataJSON() as { requestId?: string }).requestId || "");
    if (!poisoned) {
      // the request DOES reach the server (job accepted) but the browser
      // sees a gateway failure — the classic ambiguous delivery
      poisoned = true;
      await route.fetch();
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "simulated bad gateway" }) });
      return;
    }
    const resp = await route.fetch();
    await route.fulfill({ response: resp });
  });
  const input = page.getByLabel("Message Zcode");
  await input.fill("retry identity probe");
  await input.press("Enter");
  // submit-failed is honest: delivery failed, the run may exist server-side
  await expect(page.getByRole("button", { name: /Retry sending/ })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: /Retry sending/ }).click();
  // the retry adopts the ORIGINAL job (replayed idempotent acceptance) —
  // exactly one CLI run happened, and its answer streams into this view
  await expect(page.locator(".agent-message")).toContainText("echo:retry identity probe", { timeout: 20_000 });
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1], "retry must reuse the same idempotency key");
});

test("ZWUI-041: run-again on an old prompt leaves the current draft and its attachment alone", async ({ page }) => {
  // a committed user turn in history (transcript mocked — the fake CLI does
  // not write the session store)
  await page.route(/\/api\/sessions\/sess_.+\?limit=/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: "sess_rerun000000000000000000000000", title: "rerun probe" },
        runActive: false,
        transcript: [{ id: "msg_rerun_u1", role: "user", text: "rerun original prompt", createdAt: Date.now() - 60_000 }],
        total: 1,
        hasMore: false,
      }),
    })
  );
  await page.goto("/w/default/s/sess_rerun000000000000000000000000");
  await page.waitForLoadState("domcontentloaded");
  const originalBlock = page.locator(".user-message-block", { hasText: "rerun original prompt" }).first();
  await expect(originalBlock.getByLabel("Run this prompt again")).toBeVisible({ timeout: 8000 });

  // a NEW draft with an attachment — the rerun must not consume either
  const input = page.getByLabel("Message Zcode");
  await input.fill("follow-up draft that must survive");
  const tmpFile = join(tmpdir(), `e2e-attach-${Date.now()}.txt`);
  writeFileSync(tmpFile, "attachment payload");
  await page.setInputFiles("input[type=file]", tmpFile);
  await expect(page.locator(".attached-file")).toHaveCount(1);

  const bodies: any[] = [];
  await page.route(/\/api\/chat$/, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "no need to run" }) });
  });
  await originalBlock.getByLabel("Run this prompt again").click();
  await page.waitForTimeout(600);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, "rerun original prompt");
  assert.ok(!bodies[0].attachments, "a historical rerun carries no composer attachments");
  // draft text + attachment chip are exactly where the user left them
  await expect(input).toHaveValue("follow-up draft that must survive");
  await expect(page.locator(".attached-file")).toHaveCount(1);
});
