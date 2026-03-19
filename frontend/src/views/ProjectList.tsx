import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Pencil, Plus, Trash2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { listProjects, createProject, updateProject, deleteProject, listGlobalAgents, saveGlobalAgents, listModels, type Project, type AgentConfig } from "../api";
import { container, card, btnPrimary, btnIcon, input as inputStyle } from "../styles";

const iconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

function hoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--bg-surface) 88%, var(--accent) 12%)";
}

function hoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--bg-surface)";
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [showAgents, setShowAgents] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const agentsLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = () => {
    setLoading(true);
    Promise.all([listProjects(), listGlobalAgents(), listModels()])
      .then(([p, a, m]) => { setProjects(p); agentsLoaded.current = false; setAgents(a); setAvailableModels(m.models); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived_at), [projects]);
  const archivedProjects = useMemo(() => projects.filter((p) => p.archived_at), [projects]);

  const isUrl = (s: string) => /^(https?:\/\/|git@)/.test(s.trim());

  const repoNameFromUrl = (url: string): string => {
    const match = url.trim().replace(/\.git$/, "").match(/[/:]([^/:]+)$/);
    return match ? match[1] : "";
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = input.trim();
    if (!val) return;
    setCreating(true);
    setError(null);
    try {
      const url = isUrl(val);
      const name = url ? repoNameFromUrl(val) : val;
      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const body: { name: string; path: string; github_url?: string } = {
        name,
        path: `/srv/projects/${slug}`,
      };
      if (url) body.github_url = val;
      const p = await createProject(body);
      setProjects((prev) => [...prev, p]);
      setInput("");
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const startRename = (p: Project) => {
    setEditingId(p.id);
    setEditValue(p.name);
  };

  const saveRename = async (id: string) => {
    const trimmed = editValue.trim();
    if (trimmed) {
      try {
        const updated = await updateProject(id, { name: trimmed });
        setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      } catch (err: any) {
        setError(err.message);
      }
    }
    setEditingId(null);
  };

  const handleArchiveToggle = async (project: Project, archived: boolean) => {
    try {
      const updated = await updateProject(project.id, { archived_at: archived ? new Date().toISOString() : null });
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updated : p)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const ALL_TOOLS = ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "web_search"];

  const updateAgent = (idx: number, patch: Partial<AgentConfig>) => {
    setAgents((prev) => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  };

  const addAgent = () => {
    const id = `agent${agents.length + 1}`;
    setAgents((prev) => [...prev, { id, name: id, is_default: prev.length === 0 }]);
  };

  const removeAgent = (idx: number) => {
    setAgents((prev) => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    if (!agentsLoaded.current) { agentsLoaded.current = true; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveGlobalAgents(agents).catch((err) => setError(err.message));
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [agents]);

  const renderProject = (p: Project, archivedView = false) => (
    <div key={p.id} style={{ ...card, gap: "12px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "100%" }}>
          {editingId === p.id ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename(p.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              style={{
                fontWeight: 600,
                fontSize: "0.875rem",
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                padding: "1px 6px",
                outline: "none",
                minWidth: 0,
                maxWidth: "16rem",
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <Link to={`/${p.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", minWidth: 0, maxWidth: "100%" }}>{p.name}</Link>
              <button
                onClick={(e) => { e.stopPropagation(); startRename(p); }}
                data-tooltip="Rename"
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px",
                  color: "var(--text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  opacity: 0.5,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
              >
                <Pencil size={13} />
              </button>
            </>
          )}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>{p.path}</div>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          style={iconBtnStyle}
          onClick={() => handleArchiveToggle(p, !archivedView)}
          title={archivedView ? "Restore project" : "Archive project"}
          aria-label={archivedView ? "Restore project" : "Archive project"}
          data-tooltip={archivedView ? "Restore project" : "Archive project"}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          {archivedView ? <RotateCcw size={16} /> : <Archive size={16} />}
        </button>
        <button
          style={iconBtnStyle}
          onClick={() => handleDelete(p.id)}
          title="Delete project"
          aria-label="Delete project"
          data-tooltip="Delete project"
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div style={container}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Projects</h1>
        <button style={btnPrimary} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "New Project"}
        </button>
      </div>

      {error && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Error: {error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} style={{ ...card, flexDirection: "column", gap: "8px", alignItems: "stretch" }}>
          <input style={inputStyle} placeholder="Project name or GitHub URL" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {input.trim() ? (isUrl(input) ? `clone → /srv/projects/${repoNameFromUrl(input)}` : `/srv/projects/${input.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}`) : "\u00A0"}
            </div>
            <button type="submit" disabled={creating || !input.trim()} style={{ ...btnPrimary, opacity: creating || !input.trim() ? 0.6 : 1 }}>
              {creating ? "Cloning..." : isUrl(input) ? "Clone" : "Create"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : activeProjects.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No active projects yet. Create one to get started.</p>
      ) : (
        <>
          {activeProjects.map((p) => renderProject(p))}
        </>
      )}

      {archivedProjects.length > 0 && (
        <div style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
          <button
            onClick={() => setShowArchived(!showArchived)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--text-muted)",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              marginBottom: showArchived ? "8px" : 0,
            }}
          >
            {showArchived ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Archived Projects ({archivedProjects.length})
          </button>
          {showArchived && archivedProjects.map((p) => renderProject(p, true))}
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <button
          onClick={() => setShowAgents(!showAgents)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--text-muted)",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {showAgents ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Global Agents ({agents.length})
        </button>

        {showAgents && (
          <div style={{ marginTop: "8px" }}>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "8px" }}>
              Default agents for all projects. Individual projects can override these.
            </div>
            {agents.map((a, i) => (
              <div key={i} style={{
                ...card,
                flexDirection: "column",
                alignItems: "stretch",
                gap: "8px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="color"
                    value={a.color || "#9b9a97"}
                    onChange={(e) => updateAgent(i, { color: e.target.value })}
                    style={{ width: 24, height: 24, border: "none", padding: 0, cursor: "pointer", background: "none" }}
                  />
                  <input
                    value={a.id}
                    onChange={(e) => updateAgent(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                    placeholder="id"
                    style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: "0.8rem" }}
                  />
                  <input
                    value={a.name}
                    onChange={(e) => updateAgent(i, { name: e.target.value })}
                    placeholder="Display name"
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "3px", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={a.is_default}
                      onChange={(e) => updateAgent(i, { is_default: e.target.checked })}
                    />
                    default
                  </label>
                  <button
                    onClick={() => removeAgent(i)}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", padding: "2px", display: "flex" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <select
                  value={a.model || ""}
                  onChange={(e) => updateAgent(i, { model: e.target.value || undefined })}
                  style={{ ...inputStyle, fontSize: "0.8rem", cursor: "pointer", paddingRight: "28px", appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
                >
                  <option value="">Global model (default)</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <textarea
                  value={a.system_prompt || ""}
                  onChange={(e) => updateAgent(i, { system_prompt: e.target.value || undefined })}
                  placeholder="Additional system prompt (optional)"
                  rows={2}
                  style={{ ...inputStyle, fontSize: "0.8rem", resize: "vertical", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginRight: "4px" }}>Tools:</span>
                  {ALL_TOOLS.map((t) => {
                    const enabled = a.tools === null || a.tools === undefined || a.tools.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          if (a.tools === null || a.tools === undefined) {
                            updateAgent(i, { tools: ALL_TOOLS.filter((x) => x !== t) });
                          } else if (enabled) {
                            const next = a.tools.filter((x) => x !== t);
                            updateAgent(i, { tools: next.length === 0 ? [] : next });
                          } else {
                            const next = [...a.tools, t];
                            updateAgent(i, { tools: next.length === ALL_TOOLS.length ? undefined : next });
                          }
                        }}
                        style={{
                          fontSize: "0.7rem",
                          fontFamily: "monospace",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          border: `1px solid ${enabled ? (a.color || "var(--accent)") : "var(--border)"}`,
                          background: enabled ? (a.color || "var(--accent)") + "22" : "transparent",
                          color: enabled ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                onClick={addAgent}
                style={{
                  ...btnPrimary,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "0.8rem",
                  padding: "4px 10px",
                  background: "var(--bg-surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                <Plus size={14} /> Add Agent
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
