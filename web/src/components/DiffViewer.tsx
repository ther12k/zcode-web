// Diff viewer ported from the clone: unified/split toggle and copy-patch —
// driven by the real `git diff` text the Changes tab already fetches
// (read-only; no invented content).
//
// ZWUI-045: the parser is a small state machine. Outside a hunk, lines
// starting with ---/+++ are file headers; INSIDE a hunk they are ordinary
// +/- content (a change to a line "-- flush" or "++ flag" must display, not
// vanish). "Copy patch" exports the ORIGINAL patch bytes — never a
// reconstruction from display rows, which loses headers and is rejected by
// `git apply`.
import { useMemo, useRef, useState } from "react";
import { Check, Columns2, Copy, FileCode2, Rows3, X } from "lucide-react";
import { IconButton, useDialogA11y } from "../ui";

export type ParsedDiff = { path: string; hunks: DiffRow[]; raw: string };
export type DiffRow = { kind: "same" | "add" | "del" | "hunk"; text: string; a?: number; b?: number };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Parse unified diff text (git format) into rows with line numbers.
// Returns null when the text carries no hunk at all (e.g. an empty diff).
export function parseUnifiedDiff(diff: string): ParsedDiff | null {
  const rows: DiffRow[] = [];
  let path: string | null = null;
  let diffGitPath: string | null = null;
  let inHunk = false;
  let a = 0, b = 0;
  for (const l of diff.split("\n")) {
    const hunk = HUNK_HEADER.exec(l);
    if (hunk) {
      inHunk = true;
      a = Number(hunk[1]);
      b = Number(hunk[2]);
      rows.push({ kind: "hunk", text: l });
      continue;
    }
    if (l.startsWith("diff --git ")) {
      inHunk = false; // the next file's headers follow
      // "diff --git a/X b/Y" — the fallback path for deletions, where the
      // +++ header is /dev/null
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l);
      if (m) diffGitPath = m[2];
      continue;
    }
    if (!inHunk) {
      if (l.startsWith("+++ ")) {
        const p = l.replace(/^\+\+\+ b\//, "").replace(/^\+\+\+ /, "");
        if (!path) path = p === "/dev/null" ? diffGitPath : p;
      }
      // ---/index/rename/mode headers and preamble are metadata, not rows
      continue;
    }
    // hunk content: only ' ', '+', '-', '\' prefixes (and the split tail "")
    if (l.startsWith("+")) { rows.push({ kind: "add", text: l.slice(1), b }); b++; }
    else if (l.startsWith("-")) { rows.push({ kind: "del", text: l.slice(1), a }); a++; }
    else if (l.startsWith(" ")) { rows.push({ kind: "same", text: l.slice(1), a, b }); a++; b++; }
    else if (l.startsWith("\\") || l === "") { /* "\ No newline" / trailing newline */ }
    else { rows.push({ kind: "same", text: l, a, b }); a++; b++; }
  }
  return rows.length && path ? { path, hunks: rows, raw: diff } : null;
}

function CopyButton({ text, label = "Copy patch" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="secondary-button diff-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch { /* clipboard unavailable */ }
      }}
    >
      {copied ? <Check size={12} className="success-text" /> : <Copy size={12} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function DiffViewerModal({ target, onClose }: { target: ParsedDiff | null; onClose: () => void }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  // remount per file so focus management follows the OPEN target, not just
  // the first mount
  const dialogKey = target?.path || "diff";

  const stats = useMemo(() => {
    if (!target) return { add: 0, del: 0 };
    return {
      add: target.hunks.filter((r) => r.kind === "add").length,
      del: target.hunks.filter((r) => r.kind === "del").length,
    };
  }, [target]);

  // split view: pair del→add runs into side-by-side rows (all hooks must run
  // unconditionally — target is nullable)
  const splitRows = useMemo(() => {
    type Split = { left?: DiffRow; right?: DiffRow };
    if (!target) return [] as Split[];
    const out: Split[] = [];
    const rows = target.hunks;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind === "del") {
        const next = rows[i + 1];
        if (next && next.kind === "add") { out.push({ left: r, right: next }); i++; }
        else out.push({ left: r });
      } else if (r.kind === "add") out.push({ right: r });
      else out.push({ left: r, right: r });
    }
    return out;
  }, [target]);

  if (!target) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog diff-dialog" role="dialog" aria-modal="true" aria-label={`Diff of ${target.path}`} ref={ref} key={dialogKey}>
        <header className="dialog-header diff-header">
          <div className="diff-title">
            <FileCode2 size={15} className="success-text" />
            <strong>{target.path}</strong>
            <span className="additions diff-stat">+{stats.add}</span>
            <span className="deletions diff-stat">−{stats.del}</span>
          </div>
          <div className="diff-actions">
            <div className="device-switch" role="tablist" aria-label="Diff layout">
              <IconButton label="Unified view" className={mode === "unified" ? "selected" : ""} onClick={() => setMode("unified")}><Rows3 size={12} /></IconButton>
              <IconButton label="Split view" className={mode === "split" ? "selected" : ""} onClick={() => setMode("split")}><Columns2 size={12} /></IconButton>
            </div>
            {/* the canonical patch, verbatim — an applicable export */}
            <CopyButton text={target.raw} />
            <IconButton label="Close diff" onClick={onClose}><X size={15} /></IconButton>
          </div>
        </header>
        <div className="diff-body">
          {mode === "unified" ? (
            <table className="diff-table">
              <tbody>
                {target.hunks.map((r, i) =>
                  r.kind === "hunk" ? (
                    <tr key={i} className="diff-hunk-row"><td colSpan={3}>{r.text}</td></tr>
                  ) : (
                    <tr key={i} className={`diff-row ${r.kind}`}>
                      <td className="diff-ln">{r.a ?? ""}</td>
                      <td className="diff-ln">{r.b ?? ""}</td>
                      <td className={`diff-code ${r.kind === "add" ? "added" : r.kind === "del" ? "removed" : ""}`}>
                        <span className="diff-sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}</span>
                        {r.text || "\u00A0"}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          ) : (
            <table className="diff-table split">
              <tbody>
                {splitRows.map((pair, i) => (
                  <tr key={i} className={pair.left?.kind === "del" && pair.right?.kind === "add" ? "paired" : ""}>
                    <td className="diff-ln">{pair.left?.a ?? ""}</td>
                    <td className={`diff-code ${pair.left?.kind === "del" ? "removed" : ""}`}>{pair.left ? pair.left.text : "\u00A0"}</td>
                    <td className="diff-ln">{pair.right?.b ?? ""}</td>
                    <td className={`diff-code ${pair.right?.kind === "add" ? "added" : ""}`}>{pair.right ? pair.right.text : "\u00A0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
