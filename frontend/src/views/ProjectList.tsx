import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { listProjects, createProject, updateProject, deleteProject, listGlobalAgents, saveGlobalAgents, type Project, type AgentConfig } from "../api";
import { container, card, btnPrimary, btnDanger, input as inputStyle } from "../styles";

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("/srv/projects/");
  const [pathTouched, setPathTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [showAgents, setShowAgents] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([listProjects(), listGlobalAgents()])
      .then(([p, a]) => { setProjects(p); setAgents(a); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    try {
      const p = await createProject({ name: name.trim(), path: path.trim() });
      setProjects((prev) => [...prev, p]);
      setName("");
      setPath("/srv/projects/");
      setPathTouched(false);
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
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
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)));
      } catch (err: any) {
        setError(err.message);
      }
    }
    setEditingId(null);
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

  // Global agent CRUD
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

  const persistAgents = async () => {
    setAgentSaving(true);
    try {
      const saved = await saveGlobalAgents(agents);
      setAgents(saved);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAgentSaving(false);
    }
  };

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
          <input style={inputStyle} placeholder="Project name" value={name} onChange={(e) => {
            setName(e.target.value);
            if (!pathTouched) {
              const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
              setPath(`/srv/projects/${slug}`);
            }
          }} autoFocus />
          <input style={inputStyle} placeholder="/srv/projects/my-project" value={path} onChange={(e) => { setPath(e.target.value); setPathTouched(true); }} />
          <button type="submit" style={{ ...btnPrimary, alignSelf: "flex-end" }}>Create</button>
        </form>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : projects.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No projects yet. Create one to get started.</p>
      ) : (
        <>
        {projects.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                    <Link to={`/${p.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</Link>
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
            <button style={btnDanger} onClick={() => handleDelete(p.id)}>Delete</button>
          </div>
        ))}

        {/* Global Agents section */}
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
                      style={{ ...inputStyle, width: "80px", fontFamily: "monospace", fontSize: "0.8rem" }}
                    />
                    <input
                      value={a.name}
                      onChange={(e) => updateAgent(i, { name: e.target.value })}
                      placeholder="Display name"
                      style={{ ...inputStyle, flex: 1 }}
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
                <button
                  onClick={persistAgents}
                  disabled={agentSaving}
                  style={{
                    ...btnPrimary,
                    fontSize: "0.8rem",
                    padding: "4px 10px",
                    opacity: agentSaving ? 0.5 : 1,
                  }}
                >
                  {agentSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
