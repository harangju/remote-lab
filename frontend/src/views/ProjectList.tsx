import { Link } from "react-router-dom";

export function ProjectList() {
  return (
    <div style={{ padding: "2rem", maxWidth: "46rem", margin: "0 auto" }}>
      <h1>Projects</h1>
      <p style={{ color: "#8b949e" }}>No projects yet. Create one to get started.</p>
      <Link to="/p/demo">Demo project</Link>
    </div>
  );
}
