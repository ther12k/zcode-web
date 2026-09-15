// ZWUI-058: versioned preferences + per-session drafts. Draft isolation
// between sessions is a correctness rule (ZWUI-012), not a nicety.
import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, loadDraft, saveDraft } from "../prefs";

beforeEach(() => {
  localStorage.clear();
});

describe("preferences store", () => {
  it("returns defaults when nothing is stored", () => {
    const p = loadPrefs();
    expect(p).toMatchObject({ version: 1, mode: "plan", fontSize: "m", hiddenSessions: [], pinnedSessions: [], displayAliases: {} });
  });

  it("resets quietly on a future version (migration hook)", () => {
    localStorage.setItem("zcode-web-prefs", JSON.stringify({ version: 99, mode: "yolo" }));
    expect(loadPrefs().mode).toBe("plan");
    expect(loadPrefs().version).toBe(1);
  });

  it("survives corrupt JSON without throwing", () => {
    localStorage.setItem("zcode-web-prefs", "{not json");
    expect(loadPrefs().fontSize).toBe("m");
  });

  it("merges patches and preserves untouched keys", () => {
    savePrefs({ mode: "build", model: "glm-4.6" });
    const next = savePrefs({ fontSize: "l" });
    expect(next.mode).toBe("build");
    expect(next.model).toBe("glm-4.6");
    expect(next.fontSize).toBe("l");
    expect(loadPrefs().fontSize).toBe("l");
  });
});

describe("per-session drafts", () => {
  it("round-trips per key and isolates sessions", () => {
    saveDraft("sess_a", "draft for a");
    saveDraft("sess_b", "draft for b");
    expect(loadDraft("sess_a")).toBe("draft for a");
    expect(loadDraft("sess_b")).toBe("draft for b");
    expect(loadDraft("sess_c")).toBe("");
  });

  it("clears the stored draft when saving an empty string", () => {
    saveDraft("sess_a", "text");
    saveDraft("sess_a", "");
    expect(loadDraft("sess_a")).toBe("");
  });
});
