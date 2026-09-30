// Permission request preview — what a pending tool call TOUCHES (command,
// file paths, file changes), computed server-side so the web card and the
// desktop dialog agree on what is being approved.
//
// Ported from the open-sourced ZCode repo (Apache-2.0):
// packages/shared/src/permission-request-preview.ts — same key heuristics
// (COMMAND_KEYS / FILE_PATH_KEYS / IGNORED_DIRECTORY_KEYS), same traversal,
// trimmed to the pure builder (no zod, no imports).

const COMMAND_KEYS = new Set(["command", "cmd", "script", "shellcommand"]);
const ARGUMENT_KEYS = new Set(["args", "argv", "arguments"]);
const FILE_PATH_KEYS = new Set([
  "path", "paths", "file",
  // ZCode Agent edit permissions often put the target under file_path/filePath.
  "file_path", "filepath", "files", "filename", "filenames", "target", "targets",
  "location", "locations",
]);
const IGNORED_DIRECTORY_KEYS = new Set(["cwd", "directory", "workingdirectory"]);
const MAX_PERMISSION_FILE_PATHS = 6;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInlineText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeBlockText(value) {
  return value.trim().replace(/\r\n/g, "\n");
}

function getStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "number" || typeof item === "boolean" || typeof item === "bigint") return String(item);
      return "";
    })
    .filter((item) => item.length > 0);
}

function readPermissionInputSource(rawSource) {
  if (!isRecord(rawSource)) return rawSource;
  if ("rawInput" in rawSource && rawSource.rawInput !== undefined) return rawSource.rawInput;
  return "input" in rawSource ? rawSource.input : rawSource;
}

function getCommandFromRecord(record) {
  for (const [key, value] of Object.entries(record)) {
    if (!COMMAND_KEYS.has(key.toLowerCase()) || typeof value !== "string") continue;
    const command = normalizeBlockText(value);
    if (command.length === 0) continue;
    for (const [argsKey, argsValue] of Object.entries(record)) {
      if (!ARGUMENT_KEYS.has(argsKey.toLowerCase())) continue;
      const args = getStringArray(argsValue);
      if (args.length > 0) return `${command} ${args.join(" ")}`;
    }
    return command;
  }
  return null;
}

function findFirstCommand(value, seen = new Set(), allowBareString = false) {
  if (typeof value === "string") {
    if (!allowBareString) return null;
    const command = normalizeBlockText(value);
    return command.length > 0 ? command : null;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    for (const item of value) {
      const nestedCommand = findFirstCommand(item, seen);
      if (nestedCommand) return nestedCommand;
    }
    return null;
  }
  if (!isRecord(value) || seen.has(value)) return null;
  seen.add(value);

  const directCommand = getCommandFromRecord(value);
  if (directCommand) return directCommand;

  for (const key of ["rawInput", "input", "params", "toolCall"]) {
    if (!(key in value)) continue;
    const nestedCommand = findFirstCommand(
      value[key],
      seen,
      key === "rawInput" || key === "input" || key === "params",
    );
    if (nestedCommand) return nestedCommand;
  }

  for (const nestedValue of Object.values(value)) {
    if (!Array.isArray(nestedValue) && !isRecord(nestedValue)) continue;
    const nestedCommand = findFirstCommand(nestedValue, seen);
    if (nestedCommand) return nestedCommand;
  }
  return null;
}

function pushUniquePath(paths, value) {
  const normalizedPath = normalizeInlineText(value);
  if (!normalizedPath || paths.includes(normalizedPath)) return;
  paths.push(normalizedPath);
}

function extractPathsFromCandidate(value, paths, seen) {
  if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
  if (typeof value === "string") {
    pushUniquePath(paths, value);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) {
      extractPathsFromCandidate(item, paths, seen);
      if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
    }
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  if (typeof value.path === "string") {
    pushUniquePath(paths, value.path);
    if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
  }
  for (const nestedValue of Object.values(value)) {
    extractPathsFromCandidate(nestedValue, paths, seen);
    if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
  }
}

function collectFilePaths(value, paths, seen = new Set()) {
  if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) {
      collectFilePaths(item, paths, seen);
      if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
    }
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const [key, candidate] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (IGNORED_DIRECTORY_KEYS.has(normalizedKey)) continue;
    if (FILE_PATH_KEYS.has(normalizedKey)) {
      extractPathsFromCandidate(candidate, paths, seen);
      if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
      continue;
    }
    if (!Array.isArray(candidate) && !isRecord(candidate)) continue;
    collectFilePaths(candidate, paths, seen);
    if (paths.length >= MAX_PERMISSION_FILE_PATHS) return;
  }
}

function collectFileChanges(value, changes, seen = new Set()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) collectFileChanges(item, changes, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  if (isRecord(value.changes)) {
    for (const [path, change] of Object.entries(value.changes)) {
      if (!isRecord(change)) continue;
      if (change.type !== "add" && change.type !== "update") continue;
      if (changes.some((item) => item.path === path && item.type === change.type)) continue;
      changes.push({ path, type: change.type });
    }
  }
  for (const nestedValue of Object.values(value)) {
    if (!Array.isArray(nestedValue) && !isRecord(nestedValue)) continue;
    collectFileChanges(nestedValue, changes, seen);
  }
}

/** Build the human preview of a permission request from its raw tool input. */
export function getPermissionRequestPreview({ title, description, kind, raw }) {
  const filePaths = [];
  collectFilePaths(raw, filePaths);
  const normalizedTitle = normalizeInlineText(String(title ?? description ?? kind ?? "")) || "permission";
  const command = findFirstCommand(readPermissionInputSource(raw), new Set(), true);
  const fileChanges = [];
  collectFileChanges(raw, fileChanges);
  const scope = command ? "command" : filePaths.length > 0 ? "file" : "generic";
  return { title: normalizedTitle, command, filePaths, scope, fileChanges };
}
