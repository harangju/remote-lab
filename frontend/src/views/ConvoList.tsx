import { useParams, Link } from "react-router-dom";

export function ConvoList() {
  const { projectId } = useParams();
  return (
    <div style={{ padding: "2rem", maxWidth: "46rem", margin: "0 auto" }}>
      <Link to="/">&larr; Projects</Link>
      <h1>Project: {projectId}</h1>
      <p style={{ color: "#8b949e" }}>No conversations yet.</p>
    </div>
  );
}
