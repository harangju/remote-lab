import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProjects, createProject, deleteProject, type Project } from "../api";
import { container, card, btnPrimary, btnDanger, input as inputStyle } from "../styles";

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("/srv/projects/");
  const [pathTouched, setPathTouched] = useState(false);

  const load = () => {
    setLoading(true);
    listProjects()
      .then(setProjects)
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

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err.message);
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
        projects.map((p) => (
          <div key={p.id} style={card}>
            <div>
              <Link to={`/p/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>{p.path}</div>
            </div>
            <button style={btnDanger} onClick={() => handleDelete(p.id)}>Delete</button>
          </div>
        ))
      )}
    </div>
  );
}
