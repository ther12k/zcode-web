// ZWUI-058: workspace alias resolution — the picker/alias→cwd contract that
// every deep link and session load depends on.
import { describe, it, expect, beforeEach } from "vitest";
import { resolveRoot, discoverWorkspaceRoot } from "../workspaceRoot";

const caps = {
  workspaceRoot: "/srv/default",
  allowedRoots: ["/srv/default", "/home/dev/Projects", "/home/dev/projects-2"],
} as Parameters<typeof resolveRoot>[0];

beforeEach(() => localStorage.clear());

describe("resolveRoot", () => {
  it("falls back to the first allowed root for 'default'", () => {
    expect(resolveRoot(caps, "default")).toBe("/srv/default");
  });

  it("matches an alias case-insensitively by last segment", () => {
    expect(resolveRoot(caps, "projects")).toBe("/home/dev/Projects");
  });

  it("matches the exact segment, not a longer suffix lookalike", () => {
    // 'projects' must not resolve to projects-2
    expect(resolveRoot(caps, "projects")).not.toBe("/home/dev/projects-2");
  });

  it("prefers the stored rootPath from prefs", () => {
    localStorage.setItem("zcode-web-prefs", JSON.stringify({ rootPath: "/home/dev/projects-2" }));
    expect(discoverWorkspaceRoot("whatever")).toBe("/home/dev/projects-2");
  });

  it("returns '' when caps are missing and no root stored", () => {
    expect(resolveRoot(null, "x")).toBe("");
    expect(discoverWorkspaceRoot("x")).toBe("");
  });

  it("uses workspaceRoot when allowedRoots is empty", () => {
    const only = { workspaceRoot: "/srv/only", allowedRoots: [] } as unknown as typeof caps;
    expect(resolveRoot(only, undefined)).toBe("/srv/only");
  });
});
