// Diff viewer ported from the clone: classic LCS line diff with
// unified/split toggle and copy-patch — driven by the real `git diff`
// text the Changes tab already fetches (read-only; no invented content).
import { useMemo, useRef, useState } from "react";
import { Check, Columns2, Copy, FileCode2, Rows3, X } from "lucide-react";
import { IconButton, useDialogA11y } from "../ui";

export type ParsedDiff = { path: string; hunks: DiffRow[] };
export type DiffRow = { kind: "same" | "add" | "del" | "hunk"; text: string; a?: number; b?: number };

// Parse unified diff text (git format) into rows with line numbers.
export function parseUnifiedDiff(diff: string): ParsedDiff | null {
  const lines = diff.split("\n");
  const pathLine = lines.find((l) => l.startsWith("+++ b/")) || lines.find((l) => l.startsWith("+++ "));
  if (!pathLine) return null;
  const path = pathLine.replace(/^\+\+\+ [ab]\//, "").replace(/^\+\+\+ /, "");
  const rows: DiffRow[] = [];
  let a = 0, b = 0;
  for (const l of lines) {
    if (l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("\\")) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      a = Number(hunk[1]);
      b = Number(hunk[2]);
      rows.push({ kind: "hunk", text: l });
      continue;
    }
    if (l.startsWith("+")) { rows.push({ kind: "add", text: l.slice(1), b }); b++; }
    else if (l.startsWith("-")) { rows.push({ kind: "del", text: l.slice(1), a }); a++; }
    else if (l.startsWith(" ")) { rows.push({ kind: "same", text: l.slice(1), a, b }); a++; b++; }
    else if (l === "" && rows.length && rows[rows.length - 1].kind !== "same") { /* trailing newline */ }
    else if (l) { rows.push({ kind: "same", text: l, a, b }); a++; b++; }
  }
  return rows.length ? { path, hunks: rows } : null;
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

  const patchText = target.hunks
    .filter((r) => r.kind !== "hunk")
    .map((r) => (r.kind === "add" ? `+${r.text}` : r.kind === "del" ? `-${r.text}` : ` ${r.text}`))
    .join("\n");

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog diff-dialog" role="dialog" aria-modal="true" aria-label={`Diff of ${target.path}`} ref={ref}>
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
            <CopyButton text={patchText} />
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

