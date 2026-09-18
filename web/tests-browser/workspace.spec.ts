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

// Regression (collapse button): the desktop width block must not clobber the
// base `.sidebar-collapsed` rail — collapsing used to hide every label while
// the column stayed at its full 238px width (a wide empty icon strip).
test.describe("desktop sidebar collapse (1280px)", () => {
  test("collapse shrinks the column to the 62px rail and expands back", async ({ page }) => {
    const sidebarW = async () => page.evaluate(() => Math.round((document.querySelector(".sidebar") as HTMLElement).getBoundingClientRect().width));
    expect(await sidebarW()).toBeGreaterThanOrEqual(190);
    await page.getByLabel("Collapse sidebar").click();
    await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
    expect(await sidebarW()).toBeLessThanOrEqual(66);
    // the sort/view switch has no 62px form — it returns when expanded
    await expect(page.locator(".sidebar-viewbar")).toBeHidden();
    // the wordmark is hidden in the rail; the logo button toggles back
    await page.getByLabel("Toggle workspace navigation").click();
    await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-collapsed/);
    expect(await sidebarW()).toBeGreaterThanOrEqual(190);
    await expect(page.locator(".sidebar-viewbar")).toBeVisible();
  });
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
  // ZWUI-063: the terminal footer is a neutral completion summary — no
  // success claim beyond the turn itself finishing
  await expect(page.locator(".message-footer, .activity")).toContainText(/Completed/, { timeout: 10000 });
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

test("ZWUI-055: a live run visibly counts elapsed time instead of hanging silently", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  // slowfirst delays the first envelope ~5s — the byline must show a
  // progressing "running · Ns" timer during the wait
  await input.fill("slowfirst elapsed probe");
  await input.press("Enter");
  await expect(page.locator(".agent-message .message-duration")).toHaveText(/running · [0-9]+s/, { timeout: 8000 });
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
  // two-column skill cards need the wide dialog, not the 512px default
  expect((await dialog.boundingBox())?.width).toBeGreaterThan(640);
  // the fake CLI registry serves three skills
  await expect(dialog.locator(".skill-card")).toHaveCount(3);
  // search filters
  await dialog.getByLabel("Search skills").fill("deploy");
  await expect(dialog.locator(".skill-card")).toHaveCount(1);
  // selecting a skill lands its prompt in the composer and closes the dialog
  await dialog.locator(".skill-card").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Message Zcode")).toHaveValue("Use the fake-deploy skill: ");
  // re-selecting the same skill must not duplicate the injected text
  await page.locator(".secondary-nav .nav-button", { hasText: "Skills" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Search skills").fill("deploy");
  await dialog.locator(".skill-card").click();
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
  // failed turns: failure indicator (never a success checkmark), duration kept
  await expect(page.locator(".task-completed").last()).toHaveText(/Turn failed · after 5s/);
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
  // ZWUI-081: the finished turn leaves a neutral "Completed" summary — the
  // "Worked for" timer is gone once the turn ends
  await expect(page.locator(".task-completed").last()).toHaveText(/Completed/);
  await expect(page.getByText("Worked for 4s")).toHaveCount(0);
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
  // load older keeps the READING POSITION: the same topmost visible turn
  // stays at the same viewport offset after the prepend (and the view never
  // jumps to the top OR chases the bottom)
  // realistic reader position: scrolled UP so the load-older button is
  // already in view (a click on an off-screen button would scroll it into
  // view first — that movement belongs to the click, not the prepend)
  await page.evaluate(() => { const el = document.querySelector(".messages-scroll") as HTMLElement; el.scrollTop = 0; });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => {
    const el = document.querySelector(".messages-scroll") as HTMLElement;
    const top = el.getBoundingClientRect().top;
    const anchor = Array.from(el.querySelectorAll("article"))
      .find((n) => (n as HTMLElement).getBoundingClientRect().bottom > top + 60) as HTMLElement | undefined;
    return { text: (anchor?.innerText || "").slice(0, 24), offset: anchor ? Math.round(anchor.getBoundingClientRect().top - top) : null };
  });
  await page.locator("button.load-older").click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate((needle) => {
    const el = document.querySelector(".messages-scroll") as HTMLElement;
    const top = el.getBoundingClientRect().top;
    const anchor = Array.from(el.querySelectorAll("article"))
      .find((n) => (n as HTMLElement).innerText.slice(0, 24) === needle) as HTMLElement | undefined;
    const distBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return {
      offset: anchor ? Math.round(anchor.getBoundingClientRect().top - top) : null,
      atTop: el.scrollTop < 10,
      chasedBottom: distBottom < 120 && el.scrollHeight > el.clientHeight + 400,
    };
  }, before.text);
  assert.ok(before.offset !== null && after.offset !== null, "anchor turn found before and after");
  assert.ok(Math.abs((after.offset as number) - (before.offset as number)) < 24,
    `reading position must hold (was ${before.offset}px from top, now ${after.offset}px)`);
  assert.ok(!after.atTop, "load-older must not yank the viewport to the top");
  assert.ok(!after.chasedBottom, "load-older must not auto-scroll back to the bottom");
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

// ZWUI-052: desktop width/resizer layers must never leak columns into phone
// viewports, and a collapsed inspector must never reserve its full column.
test.describe("phone widths (360px)", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("chat owns the full viewport; a collapsed inspector reserves nothing", async ({ page }) => {
    const geo = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chatW: Math.round((document.querySelector(".chat-panel") as HTMLElement).getBoundingClientRect().width),
      railShown: (() => { const r = document.querySelector(".pane-rail") as HTMLElement | null; return !!r && getComputedStyle(r).display !== "none"; })(),
    }));
    expect(geo.overflowX).toBe(0);
    expect(geo.chatW).toBeGreaterThanOrEqual(358);
    expect(geo.railShown).toBe(false);
  });

  test("pane switch: the inspector opens full-width and returns to chat", async ({ page }) => {
    await page.locator(".mobile-preview-button").click();
    await expect(page.locator(".preview-panel")).toBeVisible();
    const panelW = await page.evaluate(() => Math.round((document.querySelector(".preview-panel") as HTMLElement).getBoundingClientRect().width));
    expect(panelW).toBeGreaterThanOrEqual(358);
    await expect(page.getByLabel("Message Zcode")).toBeHidden();
    await page.getByLabel("Close panel").click();
    await expect(page.getByLabel("Message Zcode")).toBeVisible();
  });
});

test.describe("small tablet band (850px)", () => {
  test.use({ viewport: { width: 850, height: 390 } });

  test("a collapsed inspector reserves only its 44px rail, never the panel column", async ({ page }) => {
    const railW = async () => page.evaluate(() => Math.round((document.querySelector(".pane-rail") as HTMLElement | null)?.getBoundingClientRect().width || 0));
    const chatW = async () => page.evaluate(() => Math.round((document.querySelector(".chat-panel") as HTMLElement).getBoundingClientRect().width));
    expect(await railW()).toBeLessThanOrEqual(48);
    expect(await chatW()).toBeGreaterThanOrEqual(700);
    await page.getByLabel("Show preview panel").last().click();
    await expect(page.locator(".preview-panel")).toBeVisible();
    await page.getByLabel("Close panel").click();
    expect(await railW()).toBeLessThanOrEqual(48);
    expect(await chatW()).toBeGreaterThanOrEqual(700);
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
    // the per-turn audit needs the xl dialog — the old 512/602px widths
    // crushed the metric cards and table columns
    expect((await dialog.boundingBox())?.width).toBeGreaterThan(800);
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

  // The dialog must always fit the viewport; only its audit table scrolls
  // (metrics, table header, and actions stay pinned).
  test("token telemetry dialog fits the viewport and scrolls the table inside", async ({ page }) => {
    const longSession = {
      ...teleSession,
      transcript: Array.from({ length: 48 }, (_, i) => mkTurn(i)),
      total: 48,
    };
    await page.route(/\/api\/sessions\/sess_.+\?limit=/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longSession) })
    );
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("answer 47")).toBeVisible({ timeout: 5000 });
    await page.locator(".chat-context .token-chip").click();
    const dialog = page.getByRole("dialog", { name: /Token telemetry/i });
    await expect(dialog).toBeVisible();
    // 24 measured rows cannot fit a 720px viewport — the dialog still must
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && viewport, "dialog box and viewport must resolve");
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // header and actions are pinned without scrolling the dialog itself
    await expect(dialog.getByRole("button", { name: /Copy summary/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Export JSON/ })).toBeVisible();
    await expect(dialog.locator(".token-table tbody tr")).toHaveCount(24);
    // the table region is the scroller: content overflows and scrolls
    const scroll = dialog.locator(".token-table-scroll");
    const before = await scroll.evaluate((el) => ({ top: el.scrollTop, overflow: el.scrollHeight - el.clientHeight }));
    expect(before.overflow).toBeGreaterThan(0);
    await scroll.evaluate((el) => { el.scrollTop = 120; });
    await expect(scroll).toHaveJSProperty("scrollTop", 120);
    // the sticky header stays at the top of the scroll region
    const headBox = await dialog.locator(".token-table thead th").first().boundingBox();
    const scrollBox = await scroll.boundingBox();
    assert.ok(headBox && scrollBox);
    expect(Math.abs(headBox.y - scrollBox.y)).toBeLessThan(2);
  });

  test("agent terminal drawer lists bash evidence and is read-only", async ({ page }) => {
    await page.locator(".chat-context .context-menu-wrap button").click();
    await page.getByRole("menuitemcheckbox", { name: /Agent terminal/ }).click();
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
    const timesItem = () => page.getByRole("menuitemcheckbox", { name: /Exact times/ });
    // exact timestamps are the default byline mode (date included for older turns)
    await expect(page.locator(".message-byline time").first()).toHaveText(/\d{2}:\d{2}/);
    await bar.locator(".context-menu-wrap > button").click();
    await timesItem().click();
    await expect(page.locator(".message-byline time").first()).toHaveText(/^\d+[mhd]$/);
    // checkbox items keep the menu open — toggle straight back
    await timesItem().click();
    await expect(page.locator(".message-byline time").first()).toHaveText(/\d{2}:\d{2}/);
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

test("ZWUI-074: Enter queues a follow-up while the current turn runs", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("pause before finishing first");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });

  await input.fill("queued follow-up");
  await input.press("Enter");
  await expect(page.locator(".queued-prompts")).toContainText("1 queued follow-up", { timeout: 3000 });
  await expect(page.locator(".agent-message")).toContainText("echo:pause before finishing first", { timeout: 20_000 });
  // The queue flushes only after the first authoritative success, then the
  // second prompt runs through the ordinary job/stream path.
  await expect(page.locator(".agent-message").filter({ hasText: "echo:queued follow-up" }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".queued-prompts")).toHaveCount(0);
});

test("ZWUI-075b: queued follow-ups can be removed individually", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("wait a while before finishing");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });

  await input.fill("item one to remove");
  await input.press("Enter");
  await input.fill("item two to keep");
  await input.press("Enter");
  await expect(page.locator(".queued-prompt-chip")).toHaveCount(2);

  // remove the first one
  await page.getByLabel("Remove queued follow-up: item one to remove").click();
  await expect(page.locator(".queued-prompt-chip")).toHaveCount(1);
  await expect(page.locator(".queued-prompt-chip")).toContainText("item two to keep");

  // clean up by stopping the long run
  await page.getByLabel("Stop run").click();
});

test("ZWUI-075: reload mid-run reattaches to the in-flight job stream", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("wait a while before finishing");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await expect(page).toHaveURL(/\/s\/sess_[A-Za-z0-9-]+/, { timeout: 10_000 });

  // reload the browser while the job is still active
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  // after reload, the client adopts the running job (Stop run visible)
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 12_000 });
  await page.getByLabel("Stop run").click();
  await expect(page.locator(".message-duration")).toHaveText(/cancelled/, { timeout: 15_000 });
});

test("ZWUI-076: a follow-up on an existing session never re-fetches the transcript", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("browser integration hello");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/s\/sess_[A-Za-z0-9-]+/, { timeout: 10_000 });
  await expect(page.locator(".agent-message")).toContainText("echo:browser integration hello", { timeout: 20_000 });
  await expect(page.getByLabel("Send message")).toBeVisible({ timeout: 15_000 });

  // the initial load fetched the transcript once; a locally attached run must
  // not re-trigger it on phase changes (loader flash + wasted refetch)
  const detailRequests: string[] = [];
  page.on("request", (r) => { if (/\/api\/sessions\/sess_/.test(r.url())) detailRequests.push(r.url()); });
  await input.fill("wait a while while history stays");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(2_500);
  expect(detailRequests).toHaveLength(0);
  await page.getByLabel("Stop run").click();
  await expect(page.getByLabel("Send message")).toBeVisible({ timeout: 15_000 });
});

test("ZWUI-076: document.title reflects live runs (background-tab signal)", async ({ page }) => {
  await expect(page).toHaveTitle("zcode");
  const input = page.getByLabel("Message Zcode");
  await input.fill("wait a while in another tab");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await expect(page).toHaveTitle(/1 running — zcode/);
  await page.getByLabel("Stop run").click();
  await expect(page).toHaveTitle("zcode", { timeout: 15_000 });
});

test("ZWUI-074: Escape interrupts the active turn without clicking Stop", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("wait a while before finishing");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  const cancelResponse = page.waitForResponse(
    (r) => /\/api\/jobs\/[0-9a-f-]+\/cancel$/.test(r.url()) && r.request().method() === "POST"
  );
  await page.keyboard.press("Escape");
  await expect((await cancelResponse).status()).toBe(200);
  // SIGTERM → child close → done event can lag on a loaded CI box — the
  // composer's return to idle is the user-visible contract, give it room
  await expect(page.getByLabel("Send message")).toBeVisible({ timeout: 30_000 });
});

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
  // the composer's primary action is morphed into Stop while B runs
  await expect(page.getByLabel("Stop run")).toBeVisible();
  await expect(page.getByLabel("Send message")).toHaveCount(0);
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
  await expect(originalBlock.getByLabel("Prompt actions")).toBeVisible({ timeout: 8000 });

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
  await originalBlock.getByLabel("Prompt actions").click();
  await page.getByRole("menuitem", { name: /Run again/ }).click();
  await page.waitForTimeout(600);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, "rerun original prompt");
  assert.ok(!bodies[0].attachments, "a historical rerun carries no composer attachments");
  // draft text + attachment chip are exactly where the user left them
  await expect(input).toHaveValue("follow-up draft that must survive");
  await expect(page.locator(".attached-file")).toHaveCount(1);
});

test("ZWUI-049: splitters are keyboard-operable separators with live values", async ({ page }) => {
  const sidebar = page.locator(".sidebar-resizer");
  await expect(sidebar).toHaveAttribute("role", "separator");
  await expect(sidebar).toHaveAttribute("aria-valuenow", "238");
  await sidebar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sidebar).toHaveAttribute("aria-valuenow", "254");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(sidebar).toHaveAttribute("aria-valuenow", "206");
  await page.keyboard.press("Home");
  await expect(sidebar).toHaveAttribute("aria-valuenow", "238");
  // the inspector splitter follows the same pattern; ArrowLeft widens it
  // (the inspector starts collapsed — open it first)
  await page.getByLabel("Show preview panel").last().click();
  const panel = page.locator(".panel-resizer");
  await panel.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveAttribute("aria-valuenow", "436");
  await page.keyboard.press("End");
  await expect(panel).toHaveAttribute("aria-valuenow", "420");
  // and the width actually applies to the grid
  const width = await page.evaluate(() => getComputedStyle(document.querySelector(".workspace-main")).gridTemplateColumns.split(" ").map((s) => parseFloat(s)));
  assert.ok(width.some((w) => Math.abs(w - 420) < 2), `inspector column should be the 420px default, got ${width.join(",")}`);
});

// ---- ZWUI-051: GitHub issue references and the read-only Issues inspector ----
test.describe("issue inspector", () => {
  const GH = (n: number, over: Record<string, unknown> = {}) => ({
    number: n, title: `Issue ${n}`, state: "open", isPR: false,
    author: "ther12k", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T08:00:00Z",
    closedAt: null, body: "## Acceptance\n- [ ] first criterion\n- [x] second criterion",
    htmlUrl: `https://github.com/ther12k/zcode-web/issues/${n}`,
    comments: 1, labels: [{ name: "ux", color: "1d76db" }], assignees: ["ther12k"],
    milestone: { title: "v0.4", dueOn: null }, ...over,
  });

  test.beforeEach(async ({ page }) => {
    // (routes must exist before the shell's one-time git-status fetch, so a
    // reload after registration keeps the binding deterministic)
    // the project's origin remote binds bare #N references
    await page.route(/\/api\/git\/status.*/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        branch: "main", entries: [], remote: { host: "github.com", owner: "ther12k", repo: "zcode-web" },
      }) })
    );
    await page.route(/\/api\/github\/capability/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        enabled: true, tokenPresent: false, apiHost: "api.github.com", allowlist: [],
      }) })
    );
    await page.route(/\/api\/github\/issues\/ther12k\/zcode-web\/491$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        issue: GH(491, { title: "Improve session recovery" }), cached: false,
      }) })
    );
    await page.route(/\/api\/github\/issues\/ther12k\/zcode-web\/500$/, (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Issue not found", code: "NOT_FOUND" }) })
    );
    await page.route(/\/api\/github\/issues\/acme\/tools\/77$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        issue: GH(77, { title: "Extract helper", isPR: true, htmlUrl: "https://github.com/acme/tools/pull/77" }), cached: false,
      }) })
    );
    await page.route(/\/api\/github\/issues\/ther12k\/zcode-web\/491\/comments/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        comments: [{ id: 1, author: "reviewer", body: "Looks right to me.", createdAt: "2026-09-11T09:00:00Z", updatedAt: "2026-09-11T09:00:00Z", htmlUrl: "c" }],
        page: 1, hasMore: false,
      }) })
    );
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByLabel("Message Zcode")).toBeVisible({ timeout: 8000 });
  });

  test("mention → verified reference → click opens the real issue in the pane → add to prompt", async ({ page }) => {
    const input = page.getByLabel("Message Zcode");
    await input.fill("check #491 please");
    await input.press("Enter");
    // the verified inline reference chip appears in the streamed answer
    const chip = page.locator(".markdown a.issue-ref").first();
    await expect(chip).toHaveText(/#491/, { timeout: 20_000 });
    await chip.click();
    // the pane opens on the Issues section with the VERIFIED issue
    await expect(page.locator(".preview-panel")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Issues/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".issue-title")).toHaveText("Improve session recovery", { timeout: 8000 });
    await expect(page.locator(".issue-badge.open")).toContainText("Open");
    await expect(page.locator(".issue-label", { hasText: "ux" })).toBeVisible();
    // ☑/☐ task symbols — read-only, no checkbox inputs
    await expect(page.locator(".issue-body")).toContainText("☐ first criterion");
    await expect(page.locator(".issue-body")).toContainText("☑ second criterion");
    await expect(page.locator(".issue-body input")).toHaveCount(0);
    // the discussion loads
    await expect(page.locator(".issue-comment")).toContainText("Looks right to me.");
    // Add to prompt appends WITHOUT sending or replacing the draft
    await page.getByLabel("Add to prompt").click();
    await expect(page.getByLabel("Message Zcode")).toHaveValue(/ther12k\/zcode-web#491/);
    await expect(page.locator(".working-message")).toHaveCount(0);
    // exactly ONE echo remains (the original send) — Add to prompt neither
    // sends nor retires anything
    await expect(page.locator(".user-message-block.echo")).toHaveCount(1);
    await expect(page.locator(".user-message-block.echo")).not.toContainText("ther12k/zcode-web#491");
    // still editable and sendable
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  test("unverified and failed lookups stay honest; PRs are labeled as pull requests", async ({ page }) => {
    const input = page.getByLabel("Message Zcode");
    await input.fill("also ther12k/zcode-web#500 and acme/tools#77");
    await input.press("Enter");
    await expect(page.locator(".markdown a.issue-ref").first()).toBeVisible({ timeout: 20_000 });
    await page.locator(".markdown a.issue-ref").first().click();
    const list = page.locator(".issues-list");
    await expect(list).toBeVisible();
    // failed lookup: honest "unable to load", never a fabricated card
    await expect(list.locator(".issue-row", { hasText: "#500" })).toContainText("unable to load", { timeout: 8000 });
    // the PR is labeled, not disguised as an issue
    await expect(list.locator(".issue-row", { hasText: "#77" })).toContainText("Extract helper", { timeout: 8000 });
    await expect(list.locator(".issue-row", { hasText: "#77" })).toContainText("PR");
    // selecting the failed reference shows the unable-to-load card
    await list.locator(".issue-row", { hasText: "#500" }).click();
    await expect(page.locator(".issue-unavailable")).toContainText("Unable to load");
  });
});

// ZWUI-057 (REF2-02 breakpoint audit): the inspector column is a fixed grid
// track, so a stored/dragged panel width wider than the row must be clamped
// at render time — the shell clips overflow, an oversized panel would put
// most of the inspector off-screen with no way to reach it.
test.describe("inspector width clamps to the viewport (900px band)", () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("zcode-right-collapsed", "0");
      localStorage.setItem("zcode-panel-width", "900");
    });
    await page.goto("/w/default");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByLabel("Message Zcode")).toBeVisible();
    await page.waitForTimeout(400); // ResizeObserver → applied clamp
  });

  const probe = (page: { evaluate: (fn: () => Record<string, number>) => Promise<Record<string, number>> }) =>
    page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      const chat = document.querySelector(".chat-panel")!.getBoundingClientRect();
      const panel = document.querySelector(".preview-panel")!.getBoundingClientRect();
      return {
        vw: innerWidth,
        overflowX: doc.scrollWidth - doc.clientWidth,
        chatW: Math.round(chat.width),
        panelRight: Math.round(panel.right),
        panelW: Math.round(panel.width),
      };
    });

  test("a stored 900px panel stays inside the viewport with chat >= 300px", async ({ page }) => {
    const m = await probe(page);
    expect(m.overflowX).toBeLessThanOrEqual(1);
    expect(m.panelRight).toBeLessThanOrEqual(m.vw + 1);
    expect(m.chatW).toBeGreaterThanOrEqual(300);
    expect(m.panelW).toBeLessThanOrEqual(m.vw - 60 /* icon rail */ - 300);
  });

  test("widening the window restores the stored preference", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 800 });
    await page.waitForTimeout(400);
    const m = await probe(page);
    expect(m.panelW).toBeGreaterThanOrEqual(890); // 900 minus rounding
    expect(m.overflowX).toBeLessThanOrEqual(1);
  });

  test("dragging the divider to its max never crushes the chat", async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("zcode-panel-width"));
    const handle = page.locator(".panel-resizer");
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 700, box.y + 200, { steps: 12 }); // far left = widest
    await page.mouse.up();
    await page.waitForTimeout(300);
    const m = await probe(page);
    expect(m.overflowX).toBeLessThanOrEqual(1);
    expect(m.panelRight).toBeLessThanOrEqual(m.vw + 1);
    expect(m.chatW).toBeGreaterThanOrEqual(300);
  });
});

// ZWUI-058 coverage additions: settings persistence, attachment upload wire
// format, clipboard copy, and the two-line session row shape (ZWUI-056).
test("ZWUI-058: text size chosen in Settings applies to the shell and survives reload", async ({ page }) => {
  await page.locator(".profile-button").click();
  await expect(page.locator(".font-size-row")).toBeVisible();
  const shell = () => page.locator(".app-shell");
  const classBefore = await shell().getAttribute("class");
  await page.locator(".font-size-option").last().click();
  await expect(shell()).toHaveClass(/fs-l/);
  expect(classBefore).not.toContain("fs-l");
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveClass(/fs-l/);
  // restore so other tests (fresh contexts) are unaffected anyway; also
  // verifies switching back works
  await page.locator(".profile-button").click();
  await page.locator(".font-size-option").first().click();
  await expect(page.locator(".app-shell")).toHaveClass(/fs-xs/);
});

test("ZWUI-058: attaching a file uploads it and sends uploadRef+name in /api/chat", async ({ page }) => {
  let uploadHit = 0;
  await page.route(/\/api\/upload$/, async (route) => {
    uploadHit += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: "/e2e-uploads/hello.txt", name: "hello.txt", size: 5 }),
    });
  });
  // accept the chat locally: the real server would reject the mocked upload
  // path (it must live under the server's uploads dir); this test pins the
  // wire shape and the accepted→clear behavior, not server validation
  await page.route(/\/api\/chat$/, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job_att1", sessionId: "sess_att1", cwd: "/w", mode: "plan", model: null }),
    })
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  const chip = page.locator(".attached-file", { hasText: "hello.txt" });
  await expect(chip).toBeVisible();
  await expect(chip).not.toContainText("uploading");
  expect(uploadHit).toBe(1);
  // removing works too, then re-attach for the send assertion
  await chip.getByLabel("Remove hello.txt").click();
  await expect(page.locator(".attached-files")).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator(".attached-file", { hasText: "hello.txt" })).toBeVisible();
  const input = page.getByLabel("Message Zcode");
  await input.fill("here is the file");
  const chatResponse = page.waitForResponse(
    (r) => r.url().includes("/api/chat") && r.request().method() === "POST"
  );
  await input.press("Enter");
  const req = (await chatResponse).request();
  const body = req.postDataJSON();
  expect(body.text).toBe("here is the file");
  // wire contract: server validates plain upload paths (resolved under the
  // uploads dir) — see server/index.js /api/chat
  expect(body.attachments).toEqual(["/e2e-uploads/hello.txt"]);
  // sending clears the composer's pending chips
  await expect(page.locator(".attached-files")).toHaveCount(0);
});

test.describe("ZWUI-058: clipboard copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copy button puts the exact code text on the clipboard", async ({ page }) => {
    const input = page.getByLabel("Message Zcode");
    await input.fill("show me code");
    await input.press("Enter");
    await expect(page.locator(".code-block").first()).toBeVisible({ timeout: 20_000 });
    await page.locator(".code-block-copy").first().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // the gutter renders line numbers as separate cells — expected clipboard
    // content is the code text only, line by line
    const expected = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll(".code-block .code-line-text"));
      return lines.map((el) => (el.textContent ?? "").replace(/\u00A0$/, "")).join("\n");
    });
    expect(copied).toBe(expected);
  });
});

test("ZWUI-056: session rows render the desktop's single-line shape (title + right-aligned project/time)", async ({ page }) => {
  await page.route(/\/api\/sessions\/recent\?.*/, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [
        { id: "sess_row1", title: "row shape probe", directory: "/home/ther12k/Workspace/proj", updatedAt: 1735689600000, createdAt: 1735689600000 },
      ] }),
    })
  );
  await page.goto("/w/default");
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("tab", { name: /Sessions/ }).click();
  const row = page.locator(".task-row", { hasText: "row shape probe" });
  await expect(row.locator(".task-title")).toHaveText("row shape probe");
  await expect(row.locator(".task-meta .task-project")).toHaveText("proj");
  await expect(row.locator(".task-meta time")).toHaveCount(1);
  // one line like the desktop: the row stays ~30px tall even when active —
  // the title ellipsizes instead of wrapping to a second line
  const box = (await row.locator(".task-link").boundingBox())!;
  expect(box.height).toBeLessThan(40);
  const title = (await row.locator(".task-title").boundingBox())!;
  const time = (await row.locator(".task-meta time").boundingBox())!;
  // same line: vertical centers align, and time sits right of the title block
  const titleCenter = title.y + title.height / 2;
  const timeCenter = time.y + time.height / 2;
  expect(Math.abs(titleCenter - timeCenter)).toBeLessThan(2);
  expect(time.x).toBeGreaterThan(title.x + (title.width ?? 0) / 2);
});

// Session options menu: rename writes through to the store (title updates in
// the topbar AND the sidebar) and pin moves the row into the pinned section.
test("session options menu renames and pins the open session", async ({ page }) => {
  // the shared e2e store predates the rename columns — evolve it in place
  // (ALTER ... ADD COLUMN throws when the column already exists)
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".e2e-home", "cli", "db");
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "db.sqlite"));
  for (const col of ["title_source", "time_title_updated"]) {
    try { db.exec(`ALTER TABLE session ADD COLUMN ${col} ${col === "title_source" ? "TEXT NOT NULL DEFAULT 'first_input'" : "INTEGER"}`); } catch { /* already present */ }
  }
  // a real session row (the fake CLI's fixed id never lands in the store)
  const sid = "sess_rename_e2e_0000000000000000000000000";
  const wsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".e2e-ws");
  db.exec(`
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT);
    CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER);
    CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
  `);
  db.prepare("INSERT OR REPLACE INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)")
    .run(sid, "Before rename", wsRoot, 1, Date.now());
  db.close();
  await page.goto("/w/" + encodeURIComponent(wsRoot) + "/s/" + sid);
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  await expect(page.locator(".topbar-title")).toHaveText("Before rename");
  await page.getByLabel("Session options").click();
  await page.getByRole("menuitem", { name: "Rename session" }).click();
  await page.locator("#rename-session").fill("Renamed by e2e");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Session renamed.")).toBeVisible();
  await expect(page.locator(".topbar-title")).toHaveText("Renamed by e2e");
  // pin from the same menu — the row floats to the pinned section
  await page.getByLabel("Session options").click();
  await page.getByRole("menuitem", { name: "Pin session" }).click();
  await expect(page.locator(".pinned-section")).toBeVisible();
  await expect(page.locator(".pinned-row")).toContainText("Renamed by e2e");
});

// ZWUI-080: the composer preflights attachments against the server-advertised
// caps — over-limit files are refused at pick time, never after a base64 read
test("ZWUI-080: a sixth attachment is refused at pick time (server cap mirrored)", async ({ page }) => {
  let uploads = 0;
  await page.route(/\/api\/upload$/, async (route) => {
    uploads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: `/e2e-uploads/f${uploads}.txt`, name: `f${uploads}.txt`, size: 3 }),
    });
  });
  const files = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i + 1}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("abc"),
  }));
  await page.locator('input[type="file"]').setInputFiles(files);
  await expect(page.getByRole("alert")).toContainText("5 attachments max — skipped f6.txt");
  await expect(page.locator(".attached-file")).toHaveCount(5);
  expect(uploads).toBe(5);
});

test("ZWUI-080: an oversized attachment is rejected before upload", async ({ page }) => {
  // shrink the advertised cap so a tiny buffer counts as oversized
  await page.route(/\/api\/config$/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.maxUploadBytes = 8;
    await route.fulfill({ response: res, json: j });
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByLabel("Message Zcode")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "big.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("123456789"), // 9 bytes > the mocked 8-byte cap
  });
  await expect(page.getByRole("alert")).toContainText("big.txt: too large (9 B — limit 8 B)");
  await expect(page.locator(".attached-file")).toHaveCount(0);
});

test("model picker groups providers, searches flexibly, and refreshes live config", async ({ page }) => {
  let modelCalls = 0;
  let catalog = [
    { ref: "zai/glm-5.3", provider: "zai", providerName: "Z.AI", model: "glm-5.3", displayName: "GLM 5.3", isDefault: true },
    { ref: "zai/glm-5.3-flash", provider: "zai", providerName: "Z.AI", model: "glm-5.3-flash", displayName: "GLM 5.3 Flash", isDefault: false },
    { ref: "openai/gpt-5.2", provider: "openai", providerName: "OpenAI", model: "gpt-5.2", displayName: "GPT 5.2", isDefault: false },
  ];
  await page.route(/\/api\/models$/, async (route) => {
    modelCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: catalog }) });
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const picker = page.locator(".model-picker");
  await picker.click();
  const dialog = page.getByRole("dialog", { name: "Select model" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".model-section-label", { hasText: "Z.AI" })).toBeVisible();
  await expect(dialog.locator(".model-section-label", { hasText: "OpenAI" })).toBeVisible();
  await expect(dialog.getByText("GLM 5.3 Flash", { exact: true })).toBeVisible();
  await dialog.getByLabel("Search models or providers").fill("glm 53 flash");
  await expect(dialog.getByText("GLM 5.3 Flash", { exact: true })).toBeVisible();
  await expect(dialog.getByText("GPT 5.2", { exact: true })).toHaveCount(0);
  await dialog.getByText("GLM 5.3 Flash", { exact: true }).click();
  await expect(picker).toContainText("GLM 5.3 Flash");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("zcode-web-prefs") || "{}").model)).toBe("zai/glm-5.3-flash");
  await picker.click();
  catalog = [catalog[0], { ...catalog[2], isDefault: true }, { ref: "openai/o4-mini", provider: "openai", providerName: "OpenAI", model: "o4-mini", displayName: "o4-mini", isDefault: false }];
  const beforeRefresh = modelCalls;
  await dialog.getByLabel("Refresh models").click();
  await expect(dialog.getByText("o4-mini", { exact: true })).toBeVisible();
  expect(modelCalls).toBeGreaterThan(beforeRefresh);
});

test("ZWUI-080: composer and shell menus expose menu semantics", async ({ page }) => {
  const modeButton = page.locator(".mode-picker");
  await expect(modeButton).toHaveAttribute("aria-haspopup", "menu");
  await expect(modeButton).toHaveAttribute("aria-expanded", "false");
  await modeButton.click();
  await expect(modeButton).toHaveAttribute("aria-expanded", "true");
  const modeMenu = page.locator(".mode-popover");
  await expect(modeMenu).toHaveAttribute("role", "menu");
  await expect(modeMenu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(modeButton).toHaveAttribute("aria-expanded", "false");
  // shell session-options menu
  const options = page.getByRole("button", { name: "Session options" });
  await options.click();
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".task-popover")).toHaveAttribute("role", "menu");
  await page.keyboard.press("Escape");
  await expect(options).toHaveAttribute("aria-expanded", "false");
});

// ZWUI-082: a session with a live run shows the amber working loader on its
// sidebar row — visible without having the conversation open
test("ZWUI-082: the sidebar row of a running session shows the working loader", async ({ page }) => {
  // the fake CLI always adopts session sess_fake0… — list it in the sidebar
  // before the run starts (the fake CLI writes no session rows to the store)
  const FAKE_SID = "sess_fake0000000000000000000000000000";
  await page.route(/\/api\/sessions\/recent\?.*/, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [
        { id: FAKE_SID, title: "sidebar loader probe", directory: "/home/ther12k/Workspace/ZCode/zcode-web/.e2e-ws", updatedAt: Date.now(), createdAt: Date.now() },
      ] }),
    })
  );
  await page.goto("/w/default");
  await page.waitForLoadState("domcontentloaded");
  const row = page.locator(".sessions-list .task-row", { hasText: "sidebar loader probe" });
  await expect(row).toBeVisible();
  await expect(row.locator(".task-dot.working")).toHaveCount(0);
  // start a run in that session — the row dot pulses amber while it lives
  const input = page.getByLabel("Message Zcode");
  await row.locator(".task-link").click();
  await expect(page).toHaveURL(new RegExp(`/s/${FAKE_SID}`), { timeout: 10_000 });
  await input.fill("wait a while sidebar loader");
  await input.press("Enter");
  await expect(row.locator(".task-dot.working")).toHaveCount(1, { timeout: 10_000 });
  await expect(row).toHaveClass(/is-working/);
  // and the chat's own working row shows the amber "Working for" timer
  await expect(page.locator(".working-message")).toContainText(/Working for \d+s/, { timeout: 8000 });
  // cleanup via the explicit Stop control (deterministic target): the dot
  // retires with the run
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await page.getByLabel("Stop run").click();
  await expect(page.locator(".message-duration")).toHaveText(/cancelled/, { timeout: 15_000 });
  await expect(row.locator(".task-dot.working")).toHaveCount(0, { timeout: 10_000 });
});

// ZWUI-082: steer — interrupt the current turn and send the drafted message
// as soon as the interrupt settles
test("ZWUI-082: steer interrupts the running turn and sends the draft immediately", async ({ page }) => {
  const input = page.getByLabel("Message Zcode");
  await input.fill("wait a while before steering");
  await input.press("Enter");
  await expect(page.getByLabel("Stop run")).toBeVisible({ timeout: 8000 });
  await input.fill("steered hello");
  const steer = page.getByLabel("Steer — interrupt and send now");
  await expect(steer).toBeVisible();
  const steerClick = steer.click();
  const cancelResponse = page.waitForResponse(
    (r) => r.url().includes("/cancel") && r.request().method() === "POST",
    { timeout: 8000 }
  );
  await Promise.all([steerClick, cancelResponse.then((r) => expect(r.status()).toBe(200))]);
  // the composer cleared at steer time, and the steered text runs right after
  // the interrupt settles — its echo must appear in this session
  await expect(page.locator(".agent-message").last()).toContainText("echo:steered hello", { timeout: 25_000 });
  // the steered run adopted the same session
  await expect(page).toHaveURL(/\/s\/sess_[A-Za-z0-9-]+/, { timeout: 10_000 });
});
