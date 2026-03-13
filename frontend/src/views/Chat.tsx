import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal, FileText, Pencil, Search, Settings, ChevronDown, ChevronUp, Minimize2, Globe, ExternalLink, FolderOpen, Square, RotateCw, ShieldCheck, ShieldX, Copy, Check, Bot } from "lucide-react";
import { getConvo, updateConvo, connectWs, listProjectAgents, listFiles, listSkills, type WsEvent, type AgentConfig, type Skill } from "../api";
import { input as inputStyle, btnPrimary } from "../styles";
import { CodeBlock } from "../components/CodeBlock";
import { FilePanel } from "../components/FilePanel";
import { FileFinder } from "../components/FileFinder";
import { usePanel } from "../hooks/usePanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  input?: string;
  output?: string;
}

type ApprovalScope = "once" | "conversation" | "project";

type StreamBlock =
  | { type: "text"; content: string }
  | { type: "tool"; name: string; input?: string; output?: string }
  | { type: "tool-confirm"; tool_call_id: string; name: string; args?: string; status: "pending" | "approved" | "denied"; canAllowConversation?: boolean; canAllowProject?: boolean; approvedScope?: ApprovalScope };

interface DisplayMessage {
  role: "user" | "assistant";
  blocks: StreamBlock[];
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
  message_id?: string;
  pending?: boolean;
}

interface PendingMessage {
  message_id: string;
  text: string;
}

interface MetaInfo {
  turns: number;
  context_tokens: number;
  context_limit: number;
}

// ---------------------------------------------------------------------------
// ContextDonut — small SVG ring showing context window usage
// ---------------------------------------------------------------------------

function ContextDonut({ tokens, limit }: { tokens: number; limit: number }) {
  if (!limit) return null;
  const pct = Math.min(tokens / limit, 1);
  const r = 7;
  const circ = 2 * Math.PI * r;
  const filled = circ * pct;
  const color = pct > 0.8 ? "#d9a754" : "var(--text-muted)";
  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", cursor: "default" }}
      data-tooltip={`${(tokens / 1000).toFixed(1)}k / ${(limit / 1000).toFixed(0)}k tokens (${Math.round(pct * 100)}%)`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="9" cy="9" r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolChip — collapsible tool call display
// ---------------------------------------------------------------------------

const toolIcons: Record<string, React.FC<{ size?: number }>> = {
  bash: Terminal, read_file: FileText, write_file: Pencil,
  edit_file: Pencil, glob: Search, grep: Search, compact: Minimize2,
  web_search: Globe,
};

/** Extract a short summary from tool input for display in the chip. */
function toolSummary(name: string, input?: string): string | null {
  if (!input) return null;
  if (["read_file", "write_file", "edit_file"].includes(name)) {
    const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return pathMatch ? pathMatch[1] : input.slice(0, 60);
  }
  if (name === "bash") {
    return input.length > 60 ? input.slice(0, 57) + "..." : input;
  }
  if (name === "glob" || name === "grep") {
    const patMatch = input.match(/['"]?pattern['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return patMatch ? patMatch[1] : input.slice(0, 60);
  }
  return input.length > 60 ? input.slice(0, 57) + "..." : input;
}

/** Extract file path from tool input. */
function extractFilePath(name: string, input?: string): string | null {
  if (!input || !["read_file", "write_file", "edit_file"].includes(name)) return null;
  const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
  return pathMatch ? pathMatch[1] : input.trim();
}

function ToolChip({ tool, live, onOpenFile }: {
  tool: ToolCall;
  live?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcons[tool.name] || Settings;
  const hasDetail = !!(tool.input || tool.output);
  const summary = toolSummary(tool.name, tool.input);
  const filePath = extractFilePath(tool.name, tool.input);
  const isFileOp = !!filePath;
  const showStatusSlot = live || !!tool.output || (isFileOp && !!onOpenFile);

  const handleOpenFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath && onOpenFile) onOpenFile(filePath);
  };

  return (
    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", flexShrink: 0 }}>
      <button
        onClick={() => hasDetail && setOpen(!open)}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          cursor: hasDetail ? "pointer" : "default",
          color: "var(--text-muted)",
          fontSize: "0.78rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          whiteSpace: "nowrap",
          minHeight: "28px",
        }}
      >
        <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={13} />
        </span>
        <span style={{ fontFamily: "monospace" }}>{tool.name}</span>
        {summary && (
          <span style={{
            fontFamily: "monospace",
            opacity: 0.7,
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{summary}</span>
        )}
        <span style={{ width: 12, height: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {live ? (
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#d9a754",
              display: "inline-block",
              animation: "pulse 1.5s infinite",
            }} />
          ) : tool.output ? (
            <span style={{ opacity: 0.5, lineHeight: 1 }}>&#10003;</span>
          ) : isFileOp && onOpenFile ? (
            <span
              onClick={handleOpenFile}
              style={{ display: "inline-flex", alignItems: "center", opacity: 0.5 }}
              data-tooltip="Open in panel"
            >
              <ExternalLink size={12} />
            </span>
          ) : showStatusSlot ? null : null}
        </span>
        <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: hasDetail ? 0.5 : 0 }}>
          {hasDetail && (open ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
        </span>
      </button>
      {open && hasDetail && (
        <pre style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "6px 10px",
          marginTop: "4px",
          fontSize: "0.75rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: "200px",
          overflowY: "auto",
          color: "var(--text)",
        }}>{tool.input}{tool.input && tool.output ? "\n---\n" : ""}{tool.output}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalCard — inline approve/deny for tool calls requiring permission
// ---------------------------------------------------------------------------

function ApprovalCard({ block, onRespond }: {
  block: Extract<StreamBlock, { type: "tool-confirm" }>;
  onRespond: (toolCallId: string, approved: boolean, scope?: ApprovalScope) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = block.status === "pending";

  return (
    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", flexShrink: 0, maxWidth: "85%", opacity: isPending ? 1 : 0.6 }}>
      <div
        style={{
          background: "var(--bg-surface)",
          border: `1px solid ${isPending ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "6px",
          padding: "4px 8px",
          color: "var(--text-muted)",
          fontSize: "0.78rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          whiteSpace: "nowrap",
          minHeight: "28px",
          maxWidth: "100%",
        }}
      >
        <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPending ? <ShieldCheck size={13} /> : block.status === "approved" ? <ShieldCheck size={13} /> : <ShieldX size={13} />}
        </span>
        <span style={{ fontFamily: "monospace" }}>{block.name}</span>
        {block.args && (
          <span style={{
            fontFamily: "monospace",
            opacity: 0.7,
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{toolSummary(block.name, block.args)}</span>
        )}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "auto", flexShrink: 0 }}>
          {isPending ? (
            <>
              <button
                onClick={() => onRespond(block.tool_call_id, true, "once")}
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "5px",
                  padding: "3px 10px",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  minHeight: "22px",
                  boxSizing: "border-box",
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={12} /> Allow once
              </button>
              {block.canAllowConversation && (
                <button
                  onClick={() => onRespond(block.tool_call_id, true, "conversation")}
                  style={{
                    background: "transparent",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "5px",
                    padding: "3px 10px",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    minHeight: "22px",
                    boxSizing: "border-box",
                    flexShrink: 0,
                  }}
                >
                  <ShieldCheck size={12} /> Allow in convo
                </button>
              )}
              {block.canAllowProject && (
                <button
                  onClick={() => onRespond(block.tool_call_id, true, "project")}
                  style={{
                    background: "transparent",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "5px",
                    padding: "3px 10px",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    minHeight: "22px",
                    boxSizing: "border-box",
                    flexShrink: 0,
                  }}
                >
                  <ShieldCheck size={12} /> Allow in project
                </button>
              )}
              <button
                onClick={() => onRespond(block.tool_call_id, false, "once")}
                style={{
                  background: "transparent",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: "5px",
                  padding: "3px 10px",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  minHeight: "22px",
                  boxSizing: "border-box",
                  flexShrink: 0,
                }}
              >
                <ShieldX size={12} /> Deny
              </button>
            </>
          ) : null}
          <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: block.args ? 0.5 : 0 }}>
            {block.args && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
          </span>
        </div>
      </div>
      {expanded && block.args && (
        <pre style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "6px 10px",
          marginTop: "6px",
          fontSize: "0.75rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: "150px",
          overflowY: "auto",
          color: "var(--text)",
        }}>{block.args}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown wrapper with code block styling
// ---------------------------------------------------------------------------

function makeMdComponents(onOpenSnippet?: (code: string, language: string) => void): Record<string, React.FC<any>> {
  return {
    pre: ({ children }: any) => {
      const codeChild = React.Children.toArray(children).find(
        (child: any) => child?.props?.className?.startsWith("language-")
      ) as any;
      if (codeChild) {
        const lang = codeChild.props.className.replace("language-", "");
        const code = String(codeChild.props.children).replace(/\n$/, "");
        return (
          <CodeBlock
            code={code}
            language={lang}
            onOpen={onOpenSnippet ? (c, l) => onOpenSnippet(c, l) : undefined}
          />
        );
      }
      const text = extractTextContent(children);
      if (text) {
        return (
          <CodeBlock
            code={text}
            language="text"
            onOpen={onOpenSnippet ? (c, l) => onOpenSnippet(c, l) : undefined}
          />
        );
      }
      return (
        <pre style={{
          background: "var(--code-bg)",
          borderRadius: "6px",
          padding: "10px 12px",
          overflowX: "auto",
          fontSize: "0.82rem",
          margin: "6px 0",
        }}>{children}</pre>
      );
    },
    code: ({ children, className }: any) => {
      if (className?.startsWith("language-")) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code style={{
          background: "var(--code-bg)",
          borderRadius: "3px",
          padding: "1px 4px",
          fontSize: "0.85em",
          fontFamily: "monospace",
        }}>{children}</code>
      );
    },
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{children}</a>
    ),
    table: ({ children }: any) => (
      <table style={{
        borderCollapse: "collapse",
        width: "100%",
        margin: "6px 0",
        fontSize: "0.85rem",
      }}>{children}</table>
    ),
    th: ({ children }: any) => (
      <th style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
        textAlign: "left",
        background: "var(--bg)",
      }}>{children}</th>
    ),
    td: ({ children }: any) => (
      <td style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
      }}>{children}</td>
    ),
  };
}

/** Recursively extract text content from React children. */
function extractTextContent(children: any): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractTextContent).join("");
  if (children?.props?.children) return extractTextContent(children.props.children);
  return "";
}

function MdContent({ text, onOpenSnippet }: { text: string; onOpenSnippet?: (code: string, language: string) => void }) {
  const components = useMemo(() => makeMdComponents(onOpenSnippet), [onOpenSnippet]);
  return (
    <div style={{ lineHeight: 1.55 }} className="md-content">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Chat component
// ---------------------------------------------------------------------------

export function Chat() {
  const { projectId, convId } = useParams<{ projectId: string; convId: string }>();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [thinking, setThinking] = useState(false);
  const [waitingForModel, setWaitingForModel] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [autonomousToolsEnabled, setAutonomousToolsEnabled] = useState(false);
  const [savingAutonomy, setSavingAutonomy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [title, setTitle] = useState("Untitled");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [wsAttempt, setWsAttempt] = useState(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  // Track active agent info during streaming (for multi-agent labeling)
  const [activeAgent, setActiveAgent] = useState<{ id: string; name: string; color?: string } | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const activeAgentRef = useRef<{ id: string; name: string; color?: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<PendingMessage[]>([]);
  const flushingQueueRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<StreamBlock[]>([]);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Panel hook
  const panel = usePanel(projectId);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const syncPendingMessages = useCallback((updater: PendingMessage[] | ((prev: PendingMessage[]) => PendingMessage[])) => {
    setPendingMessages((prev) => {
      const next = typeof updater === "function" ? (updater as (prev: PendingMessage[]) => PendingMessage[])(prev) : updater;
      pendingMessagesRef.current = next;
      return next;
    });
  }, []);

  const markMessagePending = useCallback((messageId: string, pending: boolean) => {
    setMessages((prev) => prev.map((msg) =>
      msg.message_id === messageId ? { ...msg, pending } : msg
    ));
  }, []);

  const flushPendingQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || flushingQueueRef.current) return;
    if (pendingMessagesRef.current.length === 0) return;
    flushingQueueRef.current = true;
    try {
      for (const pending of pendingMessagesRef.current) {
        ws.send(JSON.stringify({ type: "user-message", message_id: pending.message_id, text: pending.text }));
      }
    } finally {
      flushingQueueRef.current = false;
    }
  }, []);

  const queueMessage = useCallback((text: string) => {
    const message_id = crypto.randomUUID();
    const entry = { message_id, text };
    syncPendingMessages((prev) => [...prev, entry]);
    setMessages((prev) => [...prev, {
      role: "user",
      blocks: [{ type: "text", content: text }],
      message_id,
      pending: true,
    }]);
    setBusy(true);
    setWaitingForModel(true);
    setError(null);
    return message_id;
  }, [syncPendingMessages]);

  useEffect(scrollToBottom, [messages, streamBlocks, thinking, scrollToBottom]);

  // Auto-resize textarea to fit content
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Collect touched files from conversation for FileFinder
  const touchedFiles = useMemo(() => {
    const paths = new Set<string>();
    const allBlocks = [...messages.flatMap((m) => m.blocks), ...streamBlocks];
    for (const b of allBlocks) {
      if (b.type === "tool") {
        const p = extractFilePath(b.name, b.input);
        if (p) paths.add(p);
      }
    }
    return Array.from(paths);
  }, [messages, streamBlocks]);

  /** Open a file in the panel, with dirty guard. */
  const handleOpenFile = useCallback((path: string) => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard and open another file?")) return;
    }
    panel.openFile(path);
  }, [panel]);

  /** Open a code snippet in the panel (from inline code blocks). */
  const handleOpenSnippet = useCallback((code: string, language: string) => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard and view snippet?")) return;
    }
    // For snippets, we set the file directly — no backend fetch needed
    // We do this by calling openFile with a synthetic approach
    // Actually, let's just use the panel state directly
    panel.forceClose();
    // Small delay to allow state to clear, then open
    setTimeout(() => {
      panel.openFile(`snippet.${language}`);
    }, 0);
    // Actually, snippets don't exist on disk. Let's handle this differently.
    // For now, skip snippet opening in the panel — the CodeBlock already has
    // copy and expand features. The panel is for real files.
  }, [panel]);

  /** Close panel with dirty guard. */
  const handleClosePanel = useCallback(() => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
    }
    panel.forceClose();
  }, [panel]);

  /** Toggle edit mode with dirty guard when turning off. */
  const handleToggleEdit = useCallback(() => {
    if (panel.editMode && panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
      panel.cancelEdit();
    } else {
      panel.setEditMode(!panel.editMode);
    }
  }, [panel]);

  // Load agent configs + existing messages together so agent labels resolve
  useEffect(() => {
    if (!convId || !projectId) return;
    Promise.all([
      getConvo(convId),
      listProjectAgents(projectId),
    ]).then(([detail, agentRes]) => {
        const agentList = agentRes.agents;
        setAgents(agentList);
        setTitle(detail.title || "Untitled");
        setAutonomousToolsEnabled(!!detail.autonomous_tools_enabled);
        const msgs: DisplayMessage[] = [];
        let pendingBlocks: StreamBlock[] = [];

        for (const m of detail.messages) {
          const mAny = m as any;
          if (mAny.role === "tool") {
            pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input });
          } else if (m.role === "user") {
            if (pendingBlocks.length > 0) {
              msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
              pendingBlocks = [];
            }
            msgs.push({
              role: "user",
              blocks: [{ type: "text", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
              message_id: typeof mAny.message_id === "string" ? mAny.message_id : undefined,
              pending: false,
            });
          } else if (m.role === "assistant") {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            const blocks: StreamBlock[] = [...pendingBlocks];
            if (content) blocks.push({ type: "text", content });
            if (blocks.length > 0) {
              const agentId = mAny.agent_id;
              const agentCfg = agentId ? agentList.find((a: AgentConfig) => a.id === agentId) : undefined;
              msgs.push({
                role: "assistant", blocks,
                agent_id: agentId,
                agent_name: agentCfg?.name,
                agent_color: agentCfg?.color,
              });
            }
            pendingBlocks = [];
          }
        }
        if (pendingBlocks.length > 0) {
          msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
        }
        setMessages(msgs);
        if (detail.context_limit > 0) {
          setMeta({
            turns: 0,
            context_tokens: detail.context_tokens,
            context_limit: detail.context_limit,
          });
        }
      })
      .catch((e) => setError(e.message));
  }, [convId, projectId]);

  // Load file list + skills for autocomplete
  useEffect(() => {
    if (!projectId) return;
    listFiles(projectId)
      .then((res) => setProjectFiles(res.files))
      .catch(() => setProjectFiles([]));
    listSkills(projectId)
      .then(setSkills)
      .catch(() => setSkills([]));
  }, [projectId]);

  // Connect WebSocket
  useEffect(() => {
    if (!convId) return;
    const ws = connectWs(convId);
    wsRef.current = ws;

    ws.addEventListener("message", (event) => {
      let data: WsEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (data.type) {
        case "auth-ok":
          setConnected(true);
          flushPendingQueue();
          break;
        case "message-ack":
          syncPendingMessages((prev) => prev.filter((msg) => msg.message_id !== data.message_id));
          markMessagePending(data.message_id, false);
          setError(null);
          break;
        case "running":
          setBusy(true);
          setWaitingForModel(true);
          break;
        case "agent-start": {
          const ag = { id: data.agent_id, name: data.agent_name, color: data.agent_color };
          activeAgentRef.current = ag;
          setActiveAgent(ag);
          break;
        }
        case "thinking-delta":
          setThinking(true);
          break;
        case "text-delta": {
          setThinking(false);
          setWaitingForModel(false);
          const blocks = blocksRef.current;
          const last = blocks[blocks.length - 1];
          if (last && last.type === "text") {
            last.content += data.delta;
          } else {
            blocks.push({ type: "text", content: data.delta });
          }
          blocksRef.current = [...blocks];
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-use": {
          setWaitingForModel(false);
          blocksRef.current = [...blocksRef.current, { type: "tool", name: data.name, input: data.input }];
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-result": {
          setWaitingForModel(true);
          const blocks = [...blocksRef.current];
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && b.name === data.name && !b.output) {
              blocks[i] = { ...b, output: data.output };
              // Conflict detection: if agent modified a file that's open in panel
              if (["write_file", "edit_file"].includes(data.name) && b.input) {
                const path = extractFilePath(data.name, b.input);
                if (path) panel.notifyExternalChange(path);
              }
              break;
            }
          }
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-confirm": {
          setWaitingForModel(false);
          blocksRef.current = [...blocksRef.current, {
            type: "tool-confirm" as const,
            tool_call_id: data.tool_call_id,
            name: data.name,
            args: data.args,
            status: "pending" as const,
            canAllowConversation: data.can_allow_conversation !== false,
            canAllowProject: data.can_allow_project !== false,
          }];
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "done": {
          const finalBlocks = blocksRef.current;
          if (finalBlocks.length > 0) {
            const ag = activeAgentRef.current;
            setMessages((msgs) => [...msgs, {
              role: "assistant",
              blocks: [...finalBlocks],
              agent_id: data.agent_id || ag?.id,
              agent_name: ag?.name,
              agent_color: ag?.color,
            }]);
          }
          blocksRef.current = [];
          setStreamBlocks([]);
          setThinking(false);
          setWaitingForModel(false);
          activeAgentRef.current = null;
          setActiveAgent(null);
          setMeta((prev) => ({
            turns: data.turns,
            context_tokens: data.context_tokens,
            context_limit: data.context_limit,
          }));
          setBusy(false);
          break;
        }
        case "compacted":
          setMeta((prev) => prev ? { ...prev, context_tokens: data.new_tokens } : prev);
          setMessages((msgs) => [...msgs, {
            role: "assistant" as const,
            blocks: [{ type: "tool" as const, name: "compact", input: `${(data.old_tokens / 1000).toFixed(1)}k → ${(data.new_tokens / 1000).toFixed(1)}k tokens` }],
          }]);
          setWaitingForModel(false);
          setBusy(false);
          break;
        case "skill-result":
          setMessages((msgs) => [...msgs, {
            role: "assistant" as const,
            blocks: [{ type: "tool" as const, name: data.skill, input: data.output }],
          }]);
          setWaitingForModel(false);
          setBusy(false);
          break;
        case "title-updated":
          setTitle(data.title);
          break;
        case "error":
          setError(data.message);
          if (blocksRef.current.length > 0) {
            setMessages((msgs) => [...msgs, { role: "assistant", blocks: [...blocksRef.current] }]);
          }
          blocksRef.current = [];
          setStreamBlocks([]);
          setThinking(false);
          setWaitingForModel(false);
          setBusy(false);
          break;
      }
    });

    ws.addEventListener("close", (event) => {
      setConnected(false);
      setBusy(false);
      setWaitingForModel(false);
      setThinking(false);
      if (event.code !== 1000 && event.code !== 4409) {
        reconnectTimer.current = window.setTimeout(
          () => setWsAttempt((a) => a + 1),
          2000,
        );
      }
    });
    ws.addEventListener("error", () => {
      setConnected(false);
      setBusy(false);
      setWaitingForModel(false);
      setThinking(false);
    });

    return () => {
      clearTimeout(reconnectTimer.current);
      ws.close();
    };
  }, [convId, wsAttempt]);

  const startEdit = () => {
    setEditValue(title);
    setEditing(true);
  };

  const saveTitle = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title && convId) {
      try {
        await updateConvo(convId, { title: trimmed });
        setTitle(trimmed);
      } catch {}
    }
    setEditing(false);
  };

  const toggleAutonomy = useCallback(async () => {
    if (!convId || savingAutonomy) return;
    const next = !autonomousToolsEnabled;
    setSavingAutonomy(true);
    try {
      const updated = await updateConvo(convId, { autonomous_tools_enabled: next });
      setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled);
    } catch (e: any) {
      setError(e.message || "Failed to update autonomous mode");
    } finally {
      setSavingAutonomy(false);
    }
  }, [convId, autonomousToolsEnabled, savingAutonomy]);

  // @mention autocomplete filtering (agents + files)
  type MentionMatch =
    | { type: "agent"; agent: AgentConfig }
    | { type: "file"; path: string };

  const mentionMatches = useMemo((): MentionMatch[] => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const results: MentionMatch[] = [];
    // Match agents
    for (const a of agents) {
      if (a.id.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q)) {
        results.push({ type: "agent", agent: a });
      }
    }
    // Match files — match against filename and full path
    if (projectFiles.length > 0) {
      const fileMatches: string[] = [];
      for (const f of projectFiles) {
        const lower = f.toLowerCase();
        const basename = lower.split("/").pop() || lower;
        if (lower.startsWith(q) || basename.startsWith(q) || lower.includes(q)) {
          fileMatches.push(f);
        }
        if (fileMatches.length >= 10) break;
      }
      for (const f of fileMatches) {
        results.push({ type: "file", path: f });
      }
    }
    // Show nothing when query is empty and no agents (files would be too many)
    if (q === "" && results.length > 20) {
      return results.slice(0, 20);
    }
    return results;
  }, [mentionQuery, agents, projectFiles]);

  const slashMatches = useMemo((): Skill[] => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().startsWith(q));
  }, [slashQuery, skills]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Detect @mention in progress (supports agent IDs and file paths)
    const pos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const atMatch = before.match(/@([\w./\-]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }

    // Detect /slash command at start of input
    const slashMatch = val.match(/^\/(\w*)$/);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      setSlashIdx(0);
    } else {
      setSlashQuery(null);
    }
  };

  const insertMention = (match: MentionMatch) => {
    const pos = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const after = input.slice(pos);
    const atIdx = before.lastIndexOf("@");
    const label = match.type === "agent" ? match.agent.id : match.path;
    const newVal = before.slice(0, atIdx) + `@${label} ` + after;
    setInput(newVal);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const insertSlashCommand = (skill: Skill) => {
    setInput(`/${skill.name} `);
    setSlashQuery(null);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (Shift+Enter for newline)
    if (e.key === "Enter" && !e.shiftKey && slashQuery === null && mentionQuery === null) {
      e.preventDefault();
      const text = input.trim();
      if (text) {
        setMentionQuery(null);
        setSlashQuery(null);
        if (sendText(text)) setInput("");
      }
      return;
    }

    // Slash command autocomplete
    if (slashQuery !== null && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertSlashCommand(slashMatches[slashIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }

    // @mention autocomplete
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertMention(mentionMatches[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
  };

  const stop = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    // Optimistically reset busy state so UI is responsive even if WS is flaky
    setBusy(false);
    setThinking(false);
    setWaitingForModel(false);
  };

  const handleToolApproval = useCallback((toolCallId: string, approved: boolean, scope: ApprovalScope = "once") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "tool-confirm-response", tool_call_id: toolCallId, approved, scope }));
    }
    if (approved && scope === "conversation") {
      setAutonomousToolsEnabled(true);
    }
    // Update the block status
    const blocks = blocksRef.current.map((b) =>
      b.type === "tool-confirm" && b.tool_call_id === toolCallId
        ? { ...b, status: approved ? "approved" as const : "denied" as const, approvedScope: approved ? scope : undefined }
        : b
    );
    blocksRef.current = blocks;
    setStreamBlocks([...blocks]);
  }, []);

  // Shared logic for sending a text message to the agent
  const sendText = (text: string) => {
    if (!text || busy) return false;
    const message_id = queueMessage(text);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "user-message", message_id, text }));
    } else {
      setError("Reconnecting — message queued");
    }
    return true;
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setMentionQuery(null);
    setSlashQuery(null);
    const text = input.trim();
    if (sendText(text)) setInput("");
  };

  const resend = (text: string) => {
    sendText(text);
  };

  // Inline edit state for user messages
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");

  // Keyboard shortcut: Cmd+P for file finder
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        panel.toggleFileFinder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panel.toggleFileFinder]);

  // Styles
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);

  // Styles
  const msgBubble = useCallback((role: "user" | "assistant", agentColor?: string): React.CSSProperties => ({
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "12px",
    marginBottom: "2px",
    fontSize: "0.9rem",
    wordBreak: "break-word",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? "var(--bg-user)" : "var(--bg-surface)",
    color: "var(--text)",
    border: `1px solid ${role === "user" ? "var(--border-user)" : "var(--border)"}`,
    ...(agentColor ? { borderLeft: `3px solid ${agentColor}` } : {}),
  }), []);

  const copyAssistantMessage = useCallback((idx: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgIdx(idx);
    window.setTimeout(() => {
      setCopiedMsgIdx((current) => current === idx ? null : current);
    }, 1500);
  }, []);

  const assistantCopyBtnStyle: React.CSSProperties = {
    position: "absolute",
    top: 8,
    right: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "4px",
    color: "var(--text-muted)",
    cursor: "pointer",
    opacity: 0.7,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  };

  // Resizable panel width
  const [panelWidth, setPanelWidth] = useState(500);
  const dragging = useRef(false);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const inputPlaceholder = busy
    ? "Waiting for response..."
    : isMobile
      ? "Message..."
      : "Type a message... (@ for agents/files, / for commands)";

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - e.clientX;
      setPanelWidth(Math.max(280, Math.min(window.innerWidth * 0.7, startWidth + delta)));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {/* Chat column */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
      }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ padding: "12px 1.5rem", maxWidth: "48rem", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Link to={`/${projectId}`} style={{ color: "var(--text-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", fontSize: "1.1rem" }} title="Conversations">&larr;</Link>
            {editing ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") setEditing(false);
                }}
                style={{
                  fontWeight: 600,
                  fontSize: "1rem",
                  background: "var(--bg-surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  padding: "1px 6px",
                  outline: "none",
                  minWidth: 0,
                  maxWidth: "20rem",
                }}
              />
            ) : (
              <>
                <span style={{ fontWeight: 600 }}>{title}</span>
                <button
                  onClick={startEdit}
                  data-tooltip="Rename"
                  style={{
                    background: "none",
                    border: "none",
                    padding: "2px",
                    color: "var(--text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
            <span
              data-tooltip={connected ? "Connected" : "Disconnected"}
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: connected ? "#4d9375" : "#9b9a97",
                display: "inline-block",
              }}
            />
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
              {autonomousToolsEnabled && (
                <button
                  onClick={toggleAutonomy}
                  disabled={savingAutonomy}
                  data-tooltip="Disable autonomous tool mode for this conversation"
                  style={{
                    background: "rgba(77, 147, 117, 0.12)",
                    color: "var(--accent)",
                    border: "1px solid rgba(77, 147, 117, 0.35)",
                    borderRadius: "999px",
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: savingAutonomy ? "default" : "pointer",
                  }}
                >
                  <Bot size={13} /> Auto on
                </button>
              )}
              {!autonomousToolsEnabled && (
                <button
                  onClick={toggleAutonomy}
                  disabled={savingAutonomy}
                  data-tooltip="Enable autonomous tool mode for this conversation"
                  style={{
                    background: "none",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "999px",
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: savingAutonomy ? "default" : "pointer",
                  }}
                >
                  <Bot size={13} /> Auto off
                </button>
              )}
              {meta && meta.context_limit > 0 && (
                <ContextDonut tokens={meta.context_tokens} limit={meta.context_limit} />
              )}
              <button
                onClick={panel.toggleFileFinder}
                data-tooltip="Find file (⌘P)"
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px",
                  color: "var(--text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  cursor: "pointer",
                }}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "4px", maxWidth: "48rem", width: "100%", margin: "0 auto", flex: 1 }}>
          {messages.map((m, i) => (
            <React.Fragment key={i}>
              {m.role === "assistant" && m.agent_name && (
                <div style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: m.agent_color || "var(--text-muted)",
                  marginTop: "6px",
                  marginBottom: "1px",
                  alignSelf: "flex-start",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: m.agent_color || "var(--text-muted)",
                    display: "inline-block",
                  }} />
                  {m.agent_name}
                </div>
              )}
              {m.blocks.map((b, j) => (
                b.type === "tool-confirm" ? (
                  <div key={j} style={{ alignSelf: "flex-start", margin: "4px 0 2px" }}>
                    <ApprovalCard block={b} onRespond={handleToolApproval} />
                  </div>
                ) : b.type === "tool" ? (
                  <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: "85%" }}>
                    <ToolChip tool={b} onOpenFile={handleOpenFile} />
                  </div>
                ) : b.type === "text" && b.content ? (
                  m.role === "assistant" ? (
                    <div key={j} style={{ position: "relative", maxWidth: "85%", alignSelf: "flex-start" }}>
                      <div style={{ ...msgBubble("assistant", m.agent_color), maxWidth: "100%", paddingRight: "42px" }}>
                        <MdContent text={b.content} />
                      </div>
                      <button
                        onClick={() => copyAssistantMessage(i, b.content)}
                        data-tooltip={copiedMsgIdx === i ? "Copied!" : "Copy message"}
                        style={assistantCopyBtnStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                      >
                        {copiedMsgIdx === i ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  ) : (
                    <div
                      key={j}
                      style={{ ...msgBubble(m.role, m.agent_color), opacity: m.pending ? 0.7 : 1 }}
                    >
                      {editingMsgIdx === i ? (
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          const text = editingMsgValue.trim();
                          if (text) {
                            setEditingMsgIdx(null);
                            resend(text);
                          }
                        }} style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
                          <input
                            autoFocus
                            value={editingMsgValue}
                            onChange={(e) => setEditingMsgValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingMsgIdx(null); }}
                            style={{
                              ...inputStyle,
                              background: "transparent",
                              border: "1px solid var(--border)",
                              borderRadius: "6px",
                              color: "inherit",
                              fontSize: "inherit",
                            }}
                          />
                          <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                            <button type="button" onClick={() => setEditingMsgIdx(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer" }}>Cancel</button>
                            <button type="submit" style={{ ...btnPrimary, fontSize: "0.75rem", padding: "2px 8px", borderRadius: "6px" }}>Send</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <MdContent text={b.content} />
                          {m.pending && (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 6 }}>
                              Sending…
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                ) : null
              ))}
              {/* Edit / Rerun actions for user messages */}
              {m.role === "user" && editingMsgIdx !== i && !busy && (
                <div style={{ alignSelf: "flex-end", display: "flex", gap: "2px", marginTop: "-2px", marginBottom: "2px" }}>
                  <button
                    onClick={() => {
                      const text = m.blocks.find((b) => b.type === "text")?.content || "";
                      setEditingMsgIdx(i);
                      setEditingMsgValue(text);
                    }}
                    data-tooltip="Edit & resend"
                    style={{
                      background: "none", border: "none", padding: "2px",
                      color: "var(--text-muted)", cursor: "pointer",
                      opacity: 0.4, display: "inline-flex", alignItems: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => {
                      const text = m.blocks.find((b) => b.type === "text")?.content || "";
                      if (text) resend(text);
                    }}
                    data-tooltip="Rerun"
                    style={{
                      background: "none", border: "none", padding: "2px",
                      color: "var(--text-muted)", cursor: "pointer",
                      opacity: 0.4, display: "inline-flex", alignItems: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
                  >
                    <RotateCw size={12} />
                  </button>
                </div>
              )}
            </React.Fragment>
          ))}

          {/* Live streaming: agent label */}
          {activeAgent && streamBlocks.length > 0 && (
            <div style={{
              fontSize: "0.7rem",
              fontWeight: 600,
              color: activeAgent.color || "var(--text-muted)",
              marginTop: "6px",
              marginBottom: "1px",
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: activeAgent.color || "var(--text-muted)",
                display: "inline-block",
              }} />
              {activeAgent.name}
            </div>
          )}

          {/* Live streaming blocks */}
          {streamBlocks.map((b, j) => (
            b.type === "tool-confirm" ? (
              <div key={j} style={{ alignSelf: "flex-start", margin: "4px 0 2px" }}>
                <ApprovalCard block={b} onRespond={handleToolApproval} />
              </div>
            ) : b.type === "tool" ? (
              <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: "85%" }}>
                <ToolChip tool={b} live={!b.output} onOpenFile={handleOpenFile} />
              </div>
            ) : b.type === "text" && b.content ? (
              <div key={j} style={{ position: "relative", maxWidth: "85%", alignSelf: "flex-start" }}>
                <div style={{ ...msgBubble("assistant", activeAgent?.color), maxWidth: "100%", paddingRight: "42px" }}>
                  <MdContent text={b.content} />
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(b.content)}
                  data-tooltip="Copy message"
                  style={assistantCopyBtnStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                >
                  <Copy size={12} />
                </button>
              </div>
            ) : null
          ))}

          {/* Thinking / waiting indicator */}
          {waitingForModel && (
            <div style={{
              alignSelf: "flex-start",
              padding: "10px 14px",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}>
              <span style={{ display: "inline-flex", gap: "3px" }}>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0s" }}>.</span>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.2s" }}>.</span>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.4s" }}>.</span>
              </span>
              <span>{thinking ? "Thinking" : "Working..."}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
        </div>

        {/* Input */}
        <div style={{ flexShrink: 0, padding: "0 1.5rem 12px" }}>
        <div style={{ position: "relative", maxWidth: "48rem", width: "100%", margin: "0 auto" }}>
          {/* /slash command autocomplete dropdown */}
          {slashQuery !== null && slashMatches.length > 0 && (
            <div style={{
              position: "absolute",
              bottom: "100%",
              left: 14,
              marginBottom: 4,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "4px 0",
              minWidth: 240,
              maxHeight: 300,
              overflowY: "auto",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              zIndex: 100,
            }}>
              {slashMatches.map((s, i) => (
                <div
                  key={s.name}
                  onMouseDown={(e) => { e.preventDefault(); insertSlashCommand(s); }}
                  style={{
                    padding: "6px 12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "0.85rem",
                    background: i === slashIdx ? "var(--bg-user)" : "transparent",
                  }}
                >
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>/{s.name}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{s.description}</span>
                </div>
              ))}
            </div>
          )}
          {/* @mention autocomplete dropdown (agents + files) */}
          {mentionQuery !== null && mentionMatches.length > 0 && (() => {
            const agentMatches = mentionMatches.filter((m): m is MentionMatch & { type: "agent" } => m.type === "agent");
            const fileMatches = mentionMatches.filter((m): m is MentionMatch & { type: "file" } => m.type === "file");
            let idx = 0;
            return (
              <div style={{
                position: "absolute",
                bottom: "100%",
                left: 14,
                marginBottom: 4,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "4px 0",
                minWidth: 220,
                maxHeight: 300,
                overflowY: "auto",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                zIndex: 100,
              }}>
                {agentMatches.length > 0 && fileMatches.length > 0 && (
                  <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Agents</div>
                )}
                {agentMatches.map((m) => {
                  const i = idx++;
                  return (
                    <div
                      key={`a-${m.agent.id}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                      style={{
                        padding: "6px 12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.85rem",
                        background: i === mentionIdx ? "var(--bg-user)" : "transparent",
                      }}
                    >
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: m.agent.color || "var(--text-muted)",
                        flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 600 }}>@{m.agent.id}</span>
                      <span style={{ color: "var(--text-muted)" }}>{m.agent.name}</span>
                    </div>
                  );
                })}
                {fileMatches.length > 0 && agentMatches.length > 0 && (
                  <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: "1px solid var(--border)", marginTop: 2 }}>Files</div>
                )}
                {fileMatches.length > 0 && agentMatches.length === 0 && mentionQuery !== "" && (
                  <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Files</div>
                )}
                {fileMatches.map((m) => {
                  const i = idx++;
                  const parts = m.path.split("/");
                  const filename = parts.pop() || m.path;
                  const dir = parts.join("/");
                  return (
                    <div
                      key={`f-${m.path}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                      style={{
                        padding: "6px 12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.85rem",
                        background: i === mentionIdx ? "var(--bg-user)" : "transparent",
                      }}
                    >
                      <FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                        {dir && <span style={{ color: "var(--text-muted)" }}>{dir}/</span>}
                        {filename}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <form onSubmit={send} style={{
            display: "flex",
            gap: "8px",
            padding: "10px 14px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
          }}>
            <textarea
              ref={inputRef}
              rows={1}
              style={{
                ...inputStyle,
                background: "transparent",
                border: "none",
                resize: "none",
                overflowY: "hidden",
                lineHeight: "1.5",
                minHeight: "24px",
                maxHeight: "200px",
              }}
              placeholder={inputPlaceholder}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              autoFocus
            />
            {busy ? (
              <button type="button" onClick={stop} style={{ ...btnPrimary, borderRadius: "8px", background: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <Square size={14} fill="currentColor" /> Stop
              </button>
            ) : (
              <button type="submit" style={{ ...btnPrimary, opacity: !connected ? 0.5 : 1, borderRadius: "8px" }} disabled={!connected || !input.trim()}>
                Send
              </button>
            )}
          </form>
        </div>
        </div>
      </div>

      {/* Resize handle + File panel */}
      {panel.file && (
        <>
        <div
          onMouseDown={onDragStart}
          style={{
            width: "5px",
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
            position: "relative",
            zIndex: 10,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--border)")}
          onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.background = "transparent"; }}
        />
        <div
          className="artifact-panel-wrap"
          style={{
            width: `${panelWidth}px`,
            flexShrink: 0,
            height: "calc(var(--vh, 1vh) * 100)",
            overflow: "hidden",
          }}
        >
          <FilePanel
            file={panel.file}
            editMode={panel.editMode}
            dirty={panel.dirty}
            saving={panel.saving}
            externalChange={panel.externalChange}
            onToggleEdit={handleToggleEdit}
            onContentChange={panel.updateContent}
            onSave={panel.saveFile}
            onCancel={panel.cancelEdit}
            onClose={handleClosePanel}
            onReload={panel.reloadFile}
            onDismissExternal={panel.dismissExternalChange}
          />
        </div>
        </>
      )}

      {/* File finder overlay */}
      {panel.showFileFinder && (
        <FileFinder
          files={panel.fileList || []}
          loading={panel.fileListLoading}
          touchedFiles={touchedFiles}
          onSelect={handleOpenFile}
          onClose={panel.toggleFileFinder}
        />
      )}
    </div>
  );
}
