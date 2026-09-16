import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { insideAllowedRoots, insideRoot, realpathOf, safeCwd, sessionContextMismatch } from "./security.ts";

const base = "/tmp/zcode-lugas-security-test";
const root = join(base, "workspace");
const outside = join(base, "outside");

function setup() {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
}

describe("Lugas path and session security helpers", () => {
  test("uses separator-aware containment, not sibling prefix matching", () => {
    expect(insideRoot(join(root, "project"), root)).toBe(true);
    expect(insideRoot(root + "-sibling", root)).toBe(false);
  });

  test("rejects symlink escapes even when the lexical path is inside", () => {
    setup();
    symlinkSync(outside, join(root, "linked-outside"));
    expect(insideAllowedRoots(join(root, "linked-outside", "file.txt"), [root])).toBe(false);
    expect(realpathOf(join(root, "linked-outside", "file.txt"))).toBe(join(outside, "file.txt"));
    rmSync(base, { recursive: true, force: true });
  });

  test("safeCwd permits an allowed child and rejects an escaping symlink", () => {
    setup();
    mkdirSync(join(root, "project"));
    symlinkSync(outside, join(root, "escape"));
    expect(safeCwd(join(root, "project"), [root])).toBe(join(root, "project"));
    expect(() => safeCwd(join(root, "escape"), [root])).toThrow("cwd must be inside an allowed root");
    rmSync(base, { recursive: true, force: true });
  });

  test("distinguishes forbidden sessions from wrong conversation context", () => {
    setup();
    const other = join(root, "other");
    mkdirSync(other);
    expect(sessionContextMismatch(join(root, "project"), join(root, "project"), [root])).toBeNull();
    expect(sessionContextMismatch(other, join(root, "project"), [root])).toEqual({
      code: "SESSION_CONTEXT_MISMATCH",
      canonicalDirectory: other,
    });
    symlinkSync(outside, join(root, "forbidden"));
    expect(sessionContextMismatch(join(root, "forbidden"), join(root, "project"), [root])).toEqual({
      code: "SESSION_ROOT_FORBIDDEN",
    });
    rmSync(base, { recursive: true, force: true });
  });
});
