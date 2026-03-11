// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface ConvoMeta {
  id: string;
  project_id: string;
  title: string;
  status: "idle" | "running" | "done" | "error";
  created_at: string;
  updated_at: string;
}

export interface ConvoDetail extends ConvoMeta {
  messages: Message[];
  context_tokens: number;
  context_limit: number;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const TOKEN_KEY = "ws_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Base fetch wrapper
// ---------------------------------------------------------------------------

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/chat";
    throw new Error("Unauthorized");
  }

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return request("/projects");
}

export function getProject(id: string): Promise<Project> {
  return request(`/projects/${id}`);
}

export function createProject(body: { name: string; path: string }): Promise<Project> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProject(id: string, body: { name?: string; path?: string }): Promise<Project> {
  return request(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export function listConvos(projectId: string): Promise<ConvoMeta[]> {
  return request(`/projects/${projectId}/convos`);
}

export function createConvo(projectId: string, title?: string): Promise<ConvoMeta> {
  return request(`/projects/${projectId}/convos`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getConvo(convoId: string): Promise<ConvoDetail> {
  return request(`/convos/${convoId}`);
}

export function updateConvo(convoId: string, body: { title?: string }): Promise<ConvoMeta> {
  return request(`/convos/${convoId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteConvo(convoId: string): Promise<void> {
  return request(`/convos/${convoId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function readFile(projectId: string, path: string): Promise<{ path: string; content: string }> {
  return request(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
}

export function writeFile(projectId: string, path: string, content: string): Promise<{ path: string; size: number }> {
  return request(`/projects/${projectId}/file`, {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}

export function listFiles(projectId: string): Promise<{ root: string; files: string[] }> {
  return request(`/projects/${projectId}/files`);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export type WsEvent =
  | { type: "auth-ok" }
  | { type: "running" }
  | { type: "thinking-delta"; delta: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-use"; name: string; input?: string }
  | { type: "tool-result"; name: string; output: string }
  | { type: "done"; cost: number; turns: number; context_tokens: number; context_limit: number }
  | { type: "compacted"; old_tokens: number; new_tokens: number }
  | { type: "error"; message: string };

export function connectWs(convoId: string): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${window.location.host}/api/ws/${convoId}`);

  ws.addEventListener("open", () => {
    const token = getToken();
    if (token) {
      ws.send(JSON.stringify({ type: "auth", token }));
    }
  });

  return ws;
}
