import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { getProject, listConvos, createConvo, updateConvo, updateProject, deleteConvo, type Project, type ConvoMeta } from "../api";
import { container, card, btnPrimary, btnDanger, backLink, badge } from "../styles";

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

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([getProject(projectId), listConvos(projectId)])
      .then(([p, c]) => {
        setProject(p);
        setConvos(c);
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
