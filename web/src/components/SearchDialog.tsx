// Search dialog — exact reference markup (command-search + search-results +
// command-footer classes from the ported stylesheet).
import { useEffect, useState } from "react";
import { Search, ChevronRight, SquarePen } from "lucide-react";
import { Dialog } from "../ui";

type Row = { id: string; title: string; directory: string; updatedAt: number };

export function SearchDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (id: string, directory: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const t = setTimeout(() => {
      // empty query: the 50 latest sessions across all allowed roots;
      // typing switches to the bounded title search
      const url = q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : "/api/sessions/recent?limit=50";
      void fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem("zcode-web-token") || ""}` } })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const results: Row[] = j.results || j.sessions || [];
          setRows(q.length >= 2 ? results.slice(0, 20) : results.slice(0, 50));
          setSelected(0);
        })
        .catch(() => alive && setRows([]));
    }, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <Dialog title="Find your next thought." onClose={onClose} wide>
      <div className="command-search">
        <Search size={20} />
        <input
          autoFocus
          placeholder="Search sessions across your workspace roots…"
          value={query}
          aria-label="Search sessions"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelected((i) => Math.min(i + 1, rows.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && rows[selected]) { onSelect(rows[selected].id, rows[selected].directory); onClose(); }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="search-results" role="listbox" aria-label="Matching sessions">
        <span className="popover-label">{query ? "RESULTS" : "RECENT SESSIONS"}</span>
        {rows.length ? (
          rows.map((row, i) => (
            <button
              key={row.id}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "selected" : ""}
              onMouseEnter={() => setSelected(i)}
              onClick={() => { onSelect(row.id, row.directory); onClose(); }}
            >
              <span className="search-task-icon sage"><SquarePen size={15} /></span>
              <span>
                <strong>{row.title || row.id}</strong>
                <small>{row.directory.split("/").filter(Boolean).pop()}</small>
              </span>
              {i === selected ? <kbd>↵</kbd> : <ChevronRight size={12} />}
            </button>
          ))
        ) : (
          <div className="no-search-results">
            <Search size={24} />
            <h3>No matches. Yet.</h3>
            <p>Try a different session title.</p>
          </div>
        )}
      </div>
      <footer className="command-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
        <span><kbd>↵</kbd> to open</span>
        <span>{rows.length} {rows.length === 1 ? "result" : "results"}</span>
      </footer>
    </Dialog>
  );
}
