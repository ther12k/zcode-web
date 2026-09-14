// ZWUI-045: the diff parser must not hide real changes, and "Copy patch"
// must export bytes git accepts.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff } from "../../components/DiffViewer";

// Build a REAL git patch: repo + file v1 → commit → file v2 → `git diff`.
function makePatch(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zc-diff-"));
  const git = (args: string[], cwd = dir) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), before);
  git(["add", "f.txt"]);
  git(["commit", "-qm", "v1"]);
  writeFileSync(join(dir, "f.txt"), after);
  const patch = git(["diff", "--no-color"]);
  // sanity: git itself accepts this patch (revert, then check)
  execFileSync("git", ["checkout", "--", "f.txt"], { cwd: dir });
  execFileSync("git", ["apply", "--check", "-"], { cwd: dir, input: patch });
  expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe(before); // untouched by --check
  return patch;
}

describe("parseUnifiedDiff", () => {
  it("keeps content lines that begin with -- or ++ inside a hunk (header/state machine)", () => {
    // a real diff whose CHANGED LINES look like diff headers
    const patch = makePatch(
      ["alpha", "-- flush cache", "omega"].join("\n"),
      ["alpha", "++ flag enabled", "omega"].join("\n")
    );
    const parsed = parseUnifiedDiff(patch);
    expect(parsed).not.toBeNull();
    const content = parsed!.hunks.filter((r) => r.kind !== "hunk");
    const del = content.find((r) => r.kind === "del");
    const add = content.find((r) => r.kind === "add");
    expect(del!.text).toBe("-- flush cache");
    expect(add!.text).toBe("++ flag enabled");
    // the original patch is preserved byte-for-byte
    expect(parsed!.raw).toBe(patch);
  });

  it("copied bytes round-trip through git apply --check (multi-hunk replacement run)", () => {
    const before = ["one", "two", "three", "four", "five"].join("\n");
    const after = ["one", "TWO", "TWO-B", "three", "four", "FIVE!"].join("\n");
    const patch = makePatch(before, after);
    const parsed = parseUnifiedDiff(patch)!;
    expect(parsed.path).toBe("f.txt");
    const adds = parsed.hunks.filter((r) => r.kind === "add").length;
    const dels = parsed.hunks.filter((r) => r.kind === "del").length;
    expect(adds).toBe(3);
    expect(dels).toBe(2);
    // exported bytes are the canonical patch — exactly what git validated
    expect(parsed.raw).toBe(patch);
    const dir = mkdtempSync(join(tmpdir(), "zc-apply-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "f.txt"), before);
    execFileSync("git", ["apply", "--check", "-"], { cwd: dir, input: parsed.raw });
  });

  it("parses deleted files (/dev/null source) and rename targets", () => {
    const deletion = [
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "index 111111..000000",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-bye",
      "-now",
    ].join("\n");
    const parsed = parseUnifiedDiff(deletion);
    expect(parsed!.path).toBe("gone.txt");
    expect(parsed!.hunks.filter((r) => r.kind === "del")).toHaveLength(2);
    expect(parsed!.raw).toBe(deletion);

    const rename = [
      "diff --git a/old.txt b/new.txt",
      "similarity index 90%",
      "rename from old.txt",
      "rename to new.txt",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    expect(parseUnifiedDiff(rename)!.path).toBe("new.txt");
  });

  it("returns null for a header-only diff and numbers multi-hunk runs correctly", () => {
    expect(parseUnifiedDiff("diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n")).toBeNull();
    const twoHunks = [
      "diff --git a/f.txt b/f.txt",
      "index 111..222 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -2,3 +2,3 @@",
      " ctx",
      "-old a",
      "+new a",
      " ctx",
      "@@ -20,3 +20,3 @@",
      " ctx2",
      "-old b",
      "+new b",
      " ctx2",
    ].join("\n");
    const parsed = parseUnifiedDiff(twoHunks)!;
    expect(parsed.hunks.filter((r) => r.kind === "hunk")).toHaveLength(2);
    const secondDel = parsed.hunks.filter((r) => r.kind === "del")[1];
    expect(secondDel.a).toBe(21); // a-side numbering restarts per hunk header
  });
});
