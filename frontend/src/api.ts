// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface ConvoMeta {
  id: string;
  project_id: string;
  title: string;
  status: "idle" | "running" | "done" | "error";
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  autonomous_tools_enabled?: boolean;
  last_event_at?: string;
}

export interface ConvoDetail extends ConvoMeta {
  messages: Message[];
  context_tokens: number;
  context_limit: number;
  has_more: boolean;
  next_before: number | null;
}

export interface Attachment {
  path: string;
  name: string;
  mime_type: string;
  size: number;
  kind: "image" | "file";
}

export interface Message {
  type?: string;
  role?: "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  input?: string;
  output?: string;
  tool_call_id?: string;
  message?: string;
  agent_id?: string;
  attachments?: Attachment[];
  [key: string]: unknown;
}

export interface AgentConfig {
  id: string;
  name: string;
  model?: string;
  system_prompt?: string;
  tools?: string[];
  color?: string;
  is_default: boolean;
}

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

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${res.status} ${res.statusText}`);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export function listProjects(): Promise<Project[]> {
  return request("/projects");
}

export function getProject(id: string): Promise<Project> {
  return request(`/projects/${id}`);
}

export function createProject(body: { name: string; path: string; github_url?: string }): Promise<Project> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProject(id: string, body: { name?: string; path?: string; archived_at?: string | null }): Promise<Project> {
  return request(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: "DELETE" });
}

export function listConvos(projectId: string): Promise<ConvoMeta[]> {
  return request(`/projects/${projectId}/convos`);
}

export function createConvo(projectId: string, title?: string): Promise<ConvoMeta> {
  return request(`/projects/${projectId}/convos`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getConvo(convoId: string, opts?: { before?: number; limit?: number }): Promise<ConvoDetail> {
  const params = new URLSearchParams();
  if (typeof opts?.before === "number") params.set("before", String(opts.before));
  if (typeof opts?.limit === "number") params.set("limit", String(opts.limit));
  const query = params.toString();
  return request(`/convos/${convoId}${query ? `?${query}` : ""}`);
}

export function updateConvo(convoId: string, body: { title?: string; archived_at?: string | null; autonomous_tools_enabled?: boolean }): Promise<ConvoMeta> {
  return request(`/convos/${convoId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteConvo(convoId: string): Promise<void> {
  return request(`/convos/${convoId}`, { method: "DELETE" });
}

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

export async function uploadFiles(projectId: string, files: File[]): Promise<Attachment[]> {
  const token = getToken();
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const res = await fetch(`${BASE}/projects/${projectId}/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/chat";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function listModels(): Promise<{ models: string[]; active: string }> {
  return request("/models");
}

export function listGlobalAgents(): Promise<AgentConfig[]> {
  return request("/agents");
}

export function saveGlobalAgents(agents: AgentConfig[]): Promise<AgentConfig[]> {
  return request("/agents", {
    method: "PUT",
    body: JSON.stringify(agents),
  });
}

export function listProjectAgents(projectId: string): Promise<{ agents: AgentConfig[]; custom: boolean }> {
  return request(`/projects/${projectId}/agents`);
}

export function saveProjectAgents(projectId: string, agents: AgentConfig[]): Promise<AgentConfig[]> {
  return request(`/projects/${projectId}/agents`, {
    method: "PUT",
    body: JSON.stringify(agents),
  });
}

export function deleteProjectAgents(projectId: string): Promise<void> {
  return request(`/projects/${projectId}/agents`, { method: "DELETE" });
}

export interface Skill {
  name: string;
  type: "server" | "prompt";
  description: string;
  prompt?: string;
}

export function listSkills(projectId: string): Promise<Skill[]> {
  return request(`/projects/${projectId}/skills`);
}

export type WsEvent =
  | { type: "auth-ok" }
  | { type: "message-ack"; message_id: string }
  | { type: "voice-state"; state: "starting" | "listening" | "stopped" }
  | { type: "voice-transcript"; text: string; is_final: boolean }
  | { type: "running"; run_id: string }
  | { type: "agent-start"; run_id: string; agent_id: string; agent_name: string; agent_color?: string }
  | { type: "thinking-delta"; run_id: string; delta: string; agent_id?: string }
  | { type: "text-delta"; run_id: string; delta: string; agent_id?: string }
  | { type: "tool-use"; run_id: string; name: string; input?: string; tool_call_id?: string; agent_id?: string }
  | { type: "tool-result"; run_id: string; name: string; output: string; tool_call_id?: string; agent_id?: string }
  | { type: "tool-output"; run_id: string; name: string; output: string; tool_call_id?: string; agent_id?: string }
  | { type: "file-changed"; run_id: string; path: string; change: "created" | "updated"; agent_id?: string }
  | { type: "tool-confirm"; run_id: string; tool_call_id: string; name: string; args?: string; agent_id?: string; can_allow_project?: boolean }
  | { type: "done"; run_id: string; turns: number; context_tokens: number; context_limit: number; agent_id?: string }
  | { type: "compacted"; old_tokens: number; new_tokens: number }
  | { type: "skill-result"; skill: string; output: string }
  | { type: "title-updated"; title: string }
  | { type: "error"; message: string; run_id?: string; recoverable?: boolean };

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
