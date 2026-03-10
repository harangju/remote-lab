import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getProject, listConvos, createConvo, deleteConvo, type Project, type ConvoMeta } from "../api";
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

  const handleNew = async () => {
    if (!projectId) return;
    try {
      const c = await createConvo(projectId);
      navigate(`/p/${projectId}/c/${c.id}`);
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

  return (
    <div style={container}>
      <Link to="/" style={backLink}>&larr; Projects</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{project?.name ?? "Project"}</h1>
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
                <Link to={`/p/${projectId}/c/${c.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.title || "Untitled"}
                </Link>
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
