import { useParams, Link } from "react-router-dom";

export function Chat() {
  const { projectId, convId } = useParams();
  return (
    <div style={{ padding: "2rem", maxWidth: "46rem", margin: "0 auto" }}>
      <Link to={`/p/${projectId}`}>&larr; Conversations</Link>
      <h1>Chat: {convId}</h1>
      <p style={{ color: "#8b949e" }}>Chat UI coming soon.</p>
    </div>
  );
}
