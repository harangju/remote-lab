import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProjectList } from "./views/ProjectList";
import { ConvoList } from "./views/ConvoList";
import { Chat } from "./views/Chat";
import { ProjectFile } from "./views/ProjectFile";
import { getToken, setToken } from "./api";
import { injectTheme, container, input as inputStyle, btnPrimary } from "./styles";

injectTheme();

function LoginGate({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [draft, setDraft] = useState("");

  if (token) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setToken(trimmed);
    setTokenState(trimmed);
  };

  return (
    <div style={{ ...container, marginTop: "20vh", textAlign: "center", maxWidth: "24rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Remote Lab</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
        Enter your API token to continue.
      </p>
      <form onSubmit={submit} style={{ display: "flex", gap: "8px" }}>
        <input
          style={inputStyle}
          type="password"
          placeholder="Bearer token"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <button type="submit" style={btnPrimary}>
          Go
        </button>
      </form>
    </div>
  );
}

function App() {
  return (
    <LoginGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/:projectId" element={<ConvoList />} />
          <Route path="/:projectId/file" element={<ProjectFile />} />
          <Route path="/:projectId/:convId" element={<Chat />} />
        </Routes>
      </BrowserRouter>
    </LoginGate>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
