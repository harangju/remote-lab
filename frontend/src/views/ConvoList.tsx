import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileFinder } from "../components/FileFinder";
import { listFiles } from "../api";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Archive, Pencil, Plus, Trash2, ChevronDown, ChevronUp, RotateCcw, FolderOpen, MessageSquare } from "lucide-react";
import { getProject, listConvos, createConvo, updateConvo, updateProject, deleteConvo, listProjectAgents, saveProjectAgents, deleteProjectAgents, listModels, type Project, type ConvoMeta, type AgentConfig } from "../api";
import { container, card, btnPrimary, btnDanger, btnIcon, badge, input as inputStyle } from "../styles";

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
  const [showArchived, setShowArchived] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [fileList, setFileList] = useState<string[] | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const agentsLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const convoPollInFlight = useRef(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const loadInitial = async () => {
      setLoading(true);
      setFileListLoading(true);
      try {
        const [p, c, agentRes, m, fileRes] = await Promise.all([getProject(projectId), listConvos(projectId), listProjectAgents(projectId), listModels(), listFiles(projectId)]);
        if (cancelled) return;
        setProject(p);
        setConvos(c);
        agentsLoaded.current = false;
        setAgents(agentRes.agents);
        setIsCustomAgents(agentRes.custom);
        setAvailableModels(m.models);
        setFileList(fileRes.files);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setFileListLoading(false);
        }
      }
    };

    void loadInitial();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        toggleFileFinder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fileList, fileListLoading, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const pollConvos = async () => {
      if (document.hidden || convoPollInFlight.current) return;
      convoPollInFlight.current = true;
      try {
        const next = await listConvos(projectId);
        if (!cancelled) {
          setConvos(next);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        convoPollInFlight.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void pollConvos();
    }, 2000);

    const handleVisibilityChange = () => {
      if (!document.hidden) void pollConvos();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void pollConvos();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [projectId]);

  const activeConvos = useMemo(() => convos.filter((c) => !c.archived_at), [convos]);

  const toggleFileFinder = () => {
    if (!fileList && !fileListLoading && projectId) {
      setFileListLoading(true);
      listFiles(projectId)
        .then((res) => setFileList(res.files))
        .catch(() => setFileList([]))
        .finally(() => setFileListLoading(false));
    }
    setShowFileFinder((v) => !v);
  };

  const archivedConvos = useMemo(() => convos.filter((c) => c.archived_at), [convos]);

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
        setConvos((prev) => prev.map((c) => (c.id === id ? updated : c)));
      } catch (err: any) {
        setError(err.message);
      }
    }
    setEditingId(null);
  };

  const handleArchiveToggle = async (convo: ConvoMeta, archived: boolean) => {
    try {
      const updated = await updateConvo(convo.id, { archived_at: archived ? new Date().toISOString() : null });
      setConvos((prev) => prev.map((c) => (c.id === convo.id ? updated : c)));
    } catch (err: any) {
      setError(err.message);
    }
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
    if (!projectId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProjectAgents(projectId, agents)
        .then(() => setIsCustomAgents(true))
        .catch((err) => setError(err.message));
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [agents, projectId]);

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

  const ALL_TOOLS = ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "web_search"];

  const renderConvo = (c: ConvoMeta, archivedView = false) => (
    <div key={c.id} style={{ ...card, gap: "12px", padding: "14px 16px", alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "100%" }}>
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
                <Link to={`/${projectId}/${c.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", minWidth: 0, maxWidth: "100%" }}>
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
          </div>
          <span style={{ ...badge(c.status), flexShrink: 0 }}>{c.status}</span>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
          {timeAgo(c.updated_at)}
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
        <button
          style={btnDanger}
          onClick={() => handleArchiveToggle(c, !archivedView)}
          title={archivedView ? "Restore conversation" : "Archive conversation"}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            {archivedView ? <RotateCcw size={13} /> : <Archive size={13} />}
            {archivedView ? "Restore" : "Archive"}
          </span>
        </button>
        {archivedView && <button style={btnDanger} onClick={() => handleDelete(c.id)}>Delete</button>}
      </div>
    </div>
  );

  return (
    <div style={container}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
          <Link to="/" style={{ color: "var(--text-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", fontSize: "1.3rem" }} title="Projects">&larr;</Link>
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
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "100%", flex: 1 }}>
              <h1 title={project?.name ?? "Project"} style={{ margin: 0, fontSize: "1.5rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project?.name ?? "Project"}</h1>
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
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={toggleFileFinder}
            style={btnIcon}
            data-tooltip="Open file (⌘P)"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={handleNew}
            style={btnIcon}
            data-tooltip="New conversation"
          >
            <MessageSquare size={16} />
          </button>
        </div>
      </div>

      {error && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Error: {error}</p>}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : activeConvos.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No active conversations yet.</p>
      ) : (
        activeConvos.map((c) => renderConvo(c))
      )}

      <div style={{ marginTop: "1.75rem", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
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
                    style={{
                      ...inputStyle,
                      fontSize: "0.8rem",
                      resize: "vertical",
                      fontFamily: "inherit",
                    }}
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

        {archivedConvos.length > 0 && (
          <div>
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
              Archived Conversations ({archivedConvos.length})
            </button>
            {showArchived && archivedConvos.map((c) => renderConvo(c, true))}
          </div>
        )}
      </div>

      {showFileFinder && (
        <FileFinder
          files={fileList || []}
          loading={fileListLoading}
          touchedFiles={[]}
          onSelect={(path) => { openProjectFile(path); setShowFileFinder(false); }}
          onClose={toggleFileFinder}
        />
      )}
    </div>
  );
}
