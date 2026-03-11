import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { getProject, listConvos, createConvo, updateConvo, updateProject, deleteConvo, listProjectAgents, saveProjectAgents, deleteProjectAgents, type Project, type ConvoMeta, type AgentConfig } from "../api";
import { container, card, btnPrimary, btnDanger, backLink, badge, input as inputStyle } from "../styles";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ConvoList() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [convos, setConvos] = useState<ConvoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingProject, setEditingProject] = useState(false);
  const [projectNameValue, setProjectNameValue] = useState("");
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isCustomAgents, setIsCustomAgents] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([getProject(projectId), listConvos(projectId), listProjectAgents(projectId)])
      .then(([p, c, agentRes]) => {
        setProject(p);
        setConvos(c);
        setAgents(agentRes.agents);
        setIsCustomAgents(agentRes.custom);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const startProjectRename = () => {
    setEditingProject(true);
    setProjectNameValue(project?.name ?? "");
  };

  const saveProjectRename = async () => {
    const trimmed = projectNameValue.trim();
    if (trimmed && projectId) {
      try {
        const updated = await updateProject(projectId, { name: trimmed });
        setProject((prev) => prev ? { ...prev, name: updated.name } : prev);
      } catch (err: any) {
        setError(err.message);
      }
    }
    setEditingProject(false);
  };

  const handleNew = async () => {
    if (!projectId) return;
    try {
      const c = await createConvo(projectId);
      navigate(`/${projectId}/${c.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startRename = (c: ConvoMeta) => {
    setEditingId(c.id);
    setEditValue(c.title || "Untitled");
  };

  const saveRename = async (id: string) => {
    const trimmed = editValue.trim();
    if (trimmed) {
      try {
        const updated = await updateConvo(id, { title: trimmed });
        setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)));
      } catch (err: any) {
        setError(err.message);
      }
    }
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteConvo(id);
      setConvos((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Agent CRUD
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
    if (!projectId) return;
    setAgentSaving(true);
    try {
      const saved = await saveProjectAgents(projectId, agents);
      setAgents(saved);
      setIsCustomAgents(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAgentSaving(false);
    }
  };

  const revertToGlobal = async () => {
    if (!projectId) return;
    try {
      await deleteProjectAgents(projectId);
      const res = await listProjectAgents(projectId);
      setAgents(res.agents);
      setIsCustomAgents(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Available tool names for the tool picker
  const ALL_TOOLS = ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "web_search"];

  return (
    <div style={container}>
      <Link to="/" style={backLink}>&larr; Projects</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {editingProject ? (
            <input
              autoFocus
              value={projectNameValue}
              onChange={(e) => setProjectNameValue(e.target.value)}
              onBlur={() => saveProjectRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveProjectRename();
                if (e.key === "Escape") setEditingProject(false);
              }}
              style={{
                fontWeight: 600,
                fontSize: "1.5rem",
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                padding: "1px 6px",
                outline: "none",
                minWidth: 0,
                maxWidth: "20rem",
                margin: 0,
              }}
            />
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{project?.name ?? "Project"}</h1>
              <button
                onClick={startProjectRename}
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
                <Pencil size={15} />
              </button>
            </>
          )}
        </div>
        <button style={btnPrimary} onClick={handleNew}>New Conversation</button>
      </div>

      {error && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Error: {error}</p>}

      {/* Agents section */}
      <div style={{ marginBottom: "1.5rem" }}>
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
          Agents ({agents.length})
        </button>

        {showAgents && (
          <div style={{ marginTop: "8px" }}>
            {!isCustomAgents && agents.length > 0 && (
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "8px" }}>
                Using global agents. Edit here to create a project-specific override.
              </div>
            )}
            {isCustomAgents && (
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                Custom agents for this project.
                <button
                  onClick={revertToGlobal}
                  style={{
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    color: "var(--text-muted)",
                    fontSize: "0.72rem",
                    padding: "1px 6px",
                    cursor: "pointer",
                  }}
                >
                  Revert to global
                </button>
              </div>
            )}
            {agents.map((a, i) => (
              <div key={i} style={{
                ...card,
                flexDirection: "column",
                alignItems: "stretch",
                gap: "8px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {/* Color picker */}
                  <input
                    type="color"
                    value={a.color || "#9b9a97"}
                    onChange={(e) => updateAgent(i, { color: e.target.value })}
                    style={{ width: 24, height: 24, border: "none", padding: 0, cursor: "pointer", background: "none" }}
                  />
                  {/* ID */}
                  <input
                    value={a.id}
                    onChange={(e) => updateAgent(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                    placeholder="id"
                    style={{ ...inputStyle, width: "80px", fontFamily: "monospace", fontSize: "0.8rem" }}
                  />
                  {/* Name */}
                  <input
                    value={a.name}
                    onChange={(e) => updateAgent(i, { name: e.target.value })}
                    placeholder="Display name"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {/* Default toggle */}
                  <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "3px", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={a.is_default}
                      onChange={(e) => updateAgent(i, { is_default: e.target.checked })}
                    />
                    default
                  </label>
                  {/* Delete */}
                  <button
                    onClick={() => removeAgent(i)}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", padding: "2px", display: "flex" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* System prompt */}
                <textarea
                  value={a.system_prompt || ""}
                  onChange={(e) => updateAgent(i, { system_prompt: e.target.value || undefined })}
                  placeholder="Additional system prompt (optional)"
                  rows={2}
                  style={{
                    ...inputStyle,
                    fontSize: "0.8rem",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />

                {/* Tools */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginRight: "4px" }}>Tools:</span>
                  {ALL_TOOLS.map((t) => {
                    const enabled = a.tools === null || a.tools === undefined || a.tools.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          if (a.tools === null || a.tools === undefined) {
                            // Currently all — remove this one
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

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : convos.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No conversations yet.</p>
      ) : (
        convos.map((c) => (
          <div key={c.id} style={card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(c.id);
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
                    <Link to={`/${projectId}/${c.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title || "Untitled"}
                    </Link>
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(c); }}
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
                <span style={badge(c.status)}>{c.status}</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                {timeAgo(c.updated_at)}
              </div>
            </div>
            <button style={btnDanger} onClick={() => handleDelete(c.id)}>Delete</button>
          </div>
        ))
      )}
    </div>
  );
}
