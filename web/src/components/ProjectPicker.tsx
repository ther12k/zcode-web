// ZWUI-010: project picker wired to /api/projects (list + create flow).
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspace } from "../workspace";

export function ProjectPicker() {
  const { client, updatePrefs, prefs } = useWorkspace();
  const navigate = useNavigate();
  const [roots, setRoots] = useState<{ path: string; projects: string[] }[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [rootIndex, setRootIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void client
      .projects()
      .then((r) => alive && setRoots(r.roots))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  const options = roots.flatMap((r, ri) =>
    r.projects.map((p) => ({ value: String(ri), label: p, root: r.path, rootIndex: ri }))
  );
  const currentRoot = prefs.rootPath || roots[0]?.path || "";

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        aria-label="Project directory (cwd)"
        value={prefs.rootPath}
        onChange={(e) => {
          const root = e.target.value;
          updatePrefs({ rootPath: root });
          const ws = root.split("/").filter(Boolean).pop()?.toLowerCase() || "default";
          navigate({ to: "/w/$workspace", params: { workspace: ws } });
        }}
      >
        {roots.map((r) => (
          <option key={r.path} value={r.path}>
            {r.path}
          </option>
        ))}
      </select>
      <select
        aria-label="Project"
        value={currentRoot}
        onChange={(e) => {
          // selecting a project navigates to its workspace view
          void e;
        }}
        style={{ display: "none" }}
      />
      {options.length > 0 && (
        <select
          aria-label="Project (from workspace roots)"
          onChange={(e) => {
            const opt = options[Number(e.target.selectedIndex)];
            if (!opt) return;
            updatePrefs({ rootPath: opt.root });
            const ws = opt.root.split("/").filter(Boolean).pop()?.toLowerCase() || "default";
            navigate({ to: "/w/$workspace", params: { workspace: ws } });
          }}
        >
          {options.map((o) => (
            <option key={o.root + "/" + o.label} value={String(o.rootIndex)}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button
        title="Create a new project directory on the server"
        onClick={() => setCreating(true)}
      >
        + project
      </button>
      {creating && (
        <span className="card" style={{ position: "absolute", zIndex: "var(--z-dropdown)", padding: 12 }}>
          <input
            autoFocus
            placeholder="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Escape") setCreating(false);
              if (e.key === "Enter") {
                try {
                  const created = await client.createProject(name.trim(), rootIndex);
                  setRoots((prev) =>
                    prev.map((r, i) =>
                      i === rootIndex ? { ...r, projects: [...r.projects, created.name].sort() } : r
                    )
                  );
                  updatePrefs({ rootPath: created.directory });
                  setCreating(false);
                  setName("");
                  setError(null);
                } catch (err) {
                  setError((err as Error).message);
                }
              }
            }}
          />
          <select value={rootIndex} onChange={(e) => setRootIndex(Number(e.target.value))}>
            {roots.map((r, i) => (
              <option key={r.path} value={i}>
                {r.path}
              </option>
            ))}
          </select>
          <button
            className="primary"
            onClick={async () => {
              try {
                const created = await client.createProject(name.trim(), rootIndex);
                setRoots((prev) =>
                  prev.map((r, i) =>
                    i === rootIndex ? { ...r, projects: [...r.projects, created.name].sort() } : r
                  )
                );
                updatePrefs({ rootPath: created.directory });
                setCreating(false);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Create
          </button>
          <button className="ghost" onClick={() => setCreating(false)}>
            Cancel
          </button>
          {error && <div className="error-text">{error}</div>}
        </span>
      )}
    </span>
  );
}
