// ZWUI-031: lazy read-only Code inspector (file tree + file content).
// ZWUI-032/033: real Git status/diff + Changes pane.
// All gated behind server capabilities (ZWUI-030/032): unavailable stays
// visibly unavailable — no pretend features.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";

type FileEntry = { path: string; status?: string };

export function WorkspaceInspector({ cwd }: { cwd: string }) {
  const [tab, setTab] = useState<"code" | "changes">("code");
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [content, setContent] = useState<{ path: string; content: string } | null>(null);
  const [gitEnabled, setGitEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<FileEntry[] | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const commonRoot = useMemoRoot(cwd);

  const loadFile = useCallback(
    async (path: string) => {
      try {
        // the file API is root-relative; probe via encode
        const res = await fetch(
          `/api/files/${encodeURIComponent(joinPath(commonRoot, path))}`,
          { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } }
        );
        const j = await res.json();
        if (!res.ok) throw new ApiError(res.status, j.error || "failed");
        setContent({ path, content: j.content });
      } catch (e) {
        setContent({ path, content: `⚠ ${(e as Error).message}` });
      }
    },
    [commonRoot]
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cap = await fetch("/api/files/capability").then((r) => r.json());
        if (!alive) return;
        if (!cap.enabled) {
          setFileErr("file API disabled on this deployment (ZCODE_ENABLE_FILES=1 enables it)");
          return;
        }
        // list via a shallow convention: /api/files on a directory is not
        // supported read-only yet — the project picker lists top-level; the
        // code inspector starts from known entry files.
        const candidates = ["README.md", "package.json", "index.html"];
        setFiles(candidates.map((p) => ({ path: p })));
        setFileErr(null);
      } catch {
        if (alive) setFileErr("capability probe failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [commonRoot]);

  useEffect(() => {
    if (tab !== "changes") return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(
          `/api/git/status?cwd=${encodeURIComponent(cwd)}`,
          { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } }
        );
        const j = await r.json();
        if (!alive) return;
        if (r.status === 403) setGitEnabled(false);
        else {
          setGitEnabled(true);
          setStatus(j.entries || []);
        }
      } catch {
        if (alive) setGitEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, cwd]);

  async function loadDiff(path?: string) {
    const r = await fetch(
      `/api/git/diff?cwd=${encodeURIComponent(cwd)}${path ? `&path=${encodeURIComponent(path)}` : ""}`,
      { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } }
    );
    const j = await r.json();
    setDiff(j.diff || j.error);
  }

  return (
    <div className="inspector-tabs">
      <div role="tablist" aria-label="Inspector panes" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")}>
          Code
        </button>
        <button role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>
          Changes
        </button>
      </div>

      {tab === "code" && (
        <div>
          {fileErr ? (
            <div className="muted">{fileErr}</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {(files || []).map((f) => (
                  <button
                    key={f.path}
                    className="ghost"
                    style={{ textAlign: "left", fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}
                    onClick={() => void loadFile(f.path)}
                  >
                    {f.path}
                  </button>
                ))}
              </div>
              {content && (
                <pre style={{ marginTop: 8, maxHeight: 400, overflow: "auto" }}>
                  <code>{content.content}</code>
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {tab === "changes" && (
        <div>
          {gitEnabled === false && (
            <div className="muted">git API disabled on this deployment (ZCODE_ENABLE_GIT=1 enables it)</div>
          )}
          {gitEnabled && (
            <>
              <button onClick={() => void loadDiff()}>Refresh diff</button>
              <div style={{ marginTop: 8 }}>
                {(status || []).map((e, i) => (
                  <div key={i} className="tool-card done" style={{ padding: "2px 8px" }}>
                    {e.status} · {e.path}
                  </div>
                ))}
                {!status?.length && <div className="muted">Working tree clean.</div>}
              </div>
              {diff && (
                <pre style={{ marginTop: 8, maxHeight: 400, overflow: "auto", fontSize: "var(--fs-xs)" }}>
                  <code>{diff}</code>
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function useMemoRoot(cwd: string): string {
  return cwd;
}

function joinPath(root: string, rel: string): string {
  return root.replace(/\/$/, "") + "/" + rel.replace(/^\//, "");
}
