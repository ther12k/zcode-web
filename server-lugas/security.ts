import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/** Resolve the real path of the deepest existing ancestor and preserve the
 * not-yet-created suffix. This rejects symlink escapes without requiring the
 * target file or directory to exist yet. */
export function realpathOf(input: string): string {
  let abs = resolve(String(input));
  const trail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(abs), ...trail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return abs;
      const parent = dirname(abs);
      if (parent === abs) return abs;
      trail.push(basename(abs));
      abs = parent;
    }
  }
}

export function insideRoot(abs: string, root: string): boolean {
  const candidate = resolve(abs);
  const base = resolve(root);
  return candidate === base || candidate.startsWith(base + sep);
}

export function insideAllowedRoots(input: string, roots: readonly string[]): boolean {
  const candidate = realpathOf(input);
  return roots.some((root) => insideRoot(candidate, realpathOf(root)));
}

export function lexicalInside(input: string, roots: readonly string[]): boolean {
  const candidate = resolve(input);
  return roots.some((root) => insideRoot(candidate, root));
}

export function sessionContextMismatch(
  sessionDirectory: string,
  cwd: string,
  roots: readonly string[],
): { code: "SESSION_ROOT_FORBIDDEN" | "SESSION_CONTEXT_MISMATCH"; canonicalDirectory?: string } | null {
  if (!insideAllowedRoots(sessionDirectory, roots)) return { code: "SESSION_ROOT_FORBIDDEN" };
  if (realpathOf(sessionDirectory) !== realpathOf(cwd)) {
    return { code: "SESSION_CONTEXT_MISMATCH", canonicalDirectory: sessionDirectory };
  }
  return null;
}

export function safeCwd(input: string | null | undefined, roots: readonly string[]): string {
  const primary = roots[0];
  if (!primary) throw Object.assign(new Error("no allowed workspace roots configured"), { status: 400 });
  const raw = String(input || "").trim();
  if (!raw) return primary;

  const dir = resolve(raw);
  if (lexicalInside(dir, roots)) {
    if (!insideAllowedRoots(dir, roots)) throw Object.assign(new Error("cwd must be inside an allowed root"), { status: 400 });
    return dir;
  }

  const rel = resolve(primary, "." + sep + dir.replace(/^\/+/, ""));
  if (lexicalInside(rel, roots) && insideAllowedRoots(rel, roots)) return rel;
  throw Object.assign(new Error("cwd must be inside an allowed root"), { status: 400 });
}
