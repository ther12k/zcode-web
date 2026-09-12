// Search dialog (⌘K): server-scoped session search + recent fallback.
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Dialog } from "../ui";

type Row = { id: string; title: string; directory: string; updatedAt: number };

export function SearchDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const t = setTimeout(() => {
      const url = q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : "/api/sessions/recent?root=/";
      void fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const results: Row[] = j.results || j.sessions || [];
          setRows(results.slice(0, 12));
          setSelected(0);
        })
        .catch(() => alive && setRows([]));
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  function openRow(row: Row) {
    // derive the workspace param from the session directory (encoded root path)
    onClose();
    // navigation is handled by the caller with the full path
    onSelect(row.id);
    // also stash the directory so the shell can resolve the workspace
    try { sessionStorage.setItem("zcode-search-cwd", row.directory); } catch {}
  }

  return (
    <Dialog title="Search sessions" subtitle="Titles across the configured workspace roots" onClose={onClose}>
      <input
        ref={inputRef}
        value={query}
        placeholder="Type to search…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, rows.length - 1));
          if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
          if (e.key === "Enter" && rows[selected]) { openRow(rows[selected]); }
        }}
        style={{ width: "100%" }}
      />
      <div className="search-results">
        {rows.map((row, i) => (
          <button key={row.id} className={`result ${i === selected ? "selected" : ""}`} onMouseEnter={() => setSelected(i)} onClick={() => openRow(row)}>
            <Search size={12} />
            <span>{row.title || row.id}</span>
            <small>{row.directory.split("/").filter(Boolean).pop()}</small>
          </button>
        ))}
        {!rows.length && <div className="muted" style={{ padding: 8 }}>No matching sessions.</div>}
      </div>
    </Dialog>
  );
}
