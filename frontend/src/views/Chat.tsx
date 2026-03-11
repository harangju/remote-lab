import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal, FileText, Pencil, Search, Settings, ChevronDown, ChevronUp, Minimize2 } from "lucide-react";
import { getConvo, connectWs, type WsEvent } from "../api";
import { backLink, input as inputStyle, btnPrimary } from "../styles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  input?: string;
  output?: string;
}

type StreamBlock =
  | { type: "text"; content: string }
  | { type: "tool"; name: string; input?: string; output?: string };

interface DisplayMessage {
  role: "user" | "assistant";
  blocks: StreamBlock[];
}

interface MetaInfo {
  cost: number;
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
};

function ToolChip({ tool, live }: { tool: ToolCall; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcons[tool.name] || Settings;
  const hasDetail = !!(tool.input || tool.output);

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
          gap: "5px",
          whiteSpace: "nowrap",
        }}
      >
        <Icon size={13} />
        <span style={{ fontFamily: "monospace" }}>{tool.name}</span>
        {live && <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#d9a754",
          display: "inline-block",
          animation: "pulse 1.5s infinite",
        }} />}
        {tool.output && !live && <span style={{ opacity: 0.5 }}>&#10003;</span>}
        {hasDetail && (open
          ? <ChevronUp size={13} style={{ opacity: 0.5 }} />
          : <ChevronDown size={13} style={{ opacity: 0.5 }} />
        )}
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
          maxHeight: "120px",
          overflowY: "auto",
          color: "var(--text)",
        }}>{tool.input}{tool.input && tool.output ? "\n---\n" : ""}{tool.output}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown wrapper with code block styling
// ---------------------------------------------------------------------------

const mdComponents: Record<string, React.FC<any>> = {
  pre: ({ children }: any) => (
    <pre style={{
      background: "var(--code-bg)",
      borderRadius: "6px",
      padding: "10px 12px",
      overflowX: "auto",
      fontSize: "0.82rem",
      margin: "6px 0",
    }}>{children}</pre>
  ),
  code: ({ children, className }: any) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code style={{ fontFamily: "monospace" }}>{children}</code>;
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

function MdContent({ text }: { text: string }) {
  return (
    <div style={{ lineHeight: 1.55 }} className="md-content">
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</Markdown>
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
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [wsAttempt, setWsAttempt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<StreamBlock[]>([]);
  const reconnectTimer = useRef<number>();

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, streamBlocks, thinking, scrollToBottom]);

  // Load existing messages — interleave tool calls with assistant messages
  useEffect(() => {
    if (!convId) return;
    getConvo(convId)
      .then((detail) => {
        const msgs: DisplayMessage[] = [];
        let pendingBlocks: StreamBlock[] = [];

        for (const m of detail.messages) {
          if (m.role === "tool") {
            pendingBlocks.push({ type: "tool", name: (m as any).name, input: (m as any).input });
          } else if (m.role === "user") {
            // Flush any standalone tool blocks (e.g. compact) before a user message
            if (pendingBlocks.length > 0) {
              msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
              pendingBlocks = [];
            }
            msgs.push({ role: "user", blocks: [{ type: "text", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }] });
          } else if (m.role === "assistant") {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            const blocks: StreamBlock[] = [...pendingBlocks];
            if (content) blocks.push({ type: "text", content });
            msgs.push({ role: "assistant", blocks });
            pendingBlocks = [];
          }
        }
        // Flush any trailing standalone tool blocks
        if (pendingBlocks.length > 0) {
          msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
        }
        setMessages(msgs);
        // Sum cost from all assistant messages in the persisted history
        const totalCost = detail.messages
          .filter((m) => m.role === "assistant" && typeof (m as any).cost === "number")
          .reduce((sum, m) => sum + ((m as any).cost as number), 0);
        if (detail.context_limit > 0 || totalCost > 0) {
          setMeta({
            cost: totalCost,
            turns: 0,
            context_tokens: detail.context_tokens,
            context_limit: detail.context_limit,
          });
        }
      })
      .catch((e) => setError(e.message));
  }, [convId]);

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
          break;
        case "running":
          setBusy(true);
          break;
        case "thinking-delta":
          setThinking(true);
          break;
        case "text-delta": {
          setThinking(false);
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
          blocksRef.current = [...blocksRef.current, { type: "tool", name: data.name, input: data.input }];
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-result": {
          // Find the last tool block with matching name and update its output
          const blocks = [...blocksRef.current];
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && b.name === data.name && !b.output) {
              blocks[i] = { ...b, output: data.output };
              break;
            }
          }
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "done": {
          const finalBlocks = blocksRef.current;
          if (finalBlocks.length > 0) {
            setMessages((msgs) => [...msgs, { role: "assistant", blocks: [...finalBlocks] }]);
          }
          blocksRef.current = [];
          setStreamBlocks([]);
          setThinking(false);
          setMeta((prev) => ({
            cost: (prev?.cost ?? 0) + data.cost,
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
          setBusy(false);
          break;
        case "error":
          setError(data.message);
          if (blocksRef.current.length > 0) {
            setMessages((msgs) => [...msgs, { role: "assistant", blocks: [...blocksRef.current] }]);
          }
          blocksRef.current = [];
          setStreamBlocks([]);
          setThinking(false);
          setBusy(false);
          break;
      }
    });

    ws.addEventListener("close", (event) => {
      setConnected(false);
      // Auto-reconnect on unexpected close (not user-initiated or replaced)
      if (event.code !== 1000 && event.code !== 4409) {
        reconnectTimer.current = window.setTimeout(
          () => setWsAttempt((a) => a + 1),
          2000,
        );
      }
    });
    ws.addEventListener("error", () => {
      setConnected(false);
    });

    return () => {
      clearTimeout(reconnectTimer.current);
      ws.close();
    };
  }, [convId, wsAttempt]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !wsRef.current) return;
    const isCommand = text.startsWith("/");
    if (!isCommand) {
      setMessages((prev) => [...prev, { role: "user", blocks: [{ type: "text", content: text }] }]);
    }
    setInput("");
    setBusy(true);
    setError(null);
    wsRef.current.send(text);
  };

  // Styles
  const msgBubble = (role: "user" | "assistant"): React.CSSProperties => ({
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
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", maxWidth: "48rem", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "12px 1.5rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Link to={`/p/${projectId}`} style={backLink}>&larr; Conversations</Link>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600 }}>Chat</span>
          <span
            data-tooltip={connected ? "Connected" : "Disconnected"}
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: connected ? "#4d9375" : "#9b9a97",
              display: "inline-block",
            }}
          />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            {meta && meta.context_limit > 0 && (
              <ContextDonut tokens={meta.context_tokens} limit={meta.context_limit} />
            )}
            {meta && meta.cost > 0 && (
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                ${meta.cost.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "4px" }}>
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {m.blocks.map((b, j) => (
              b.type === "tool" ? (
                <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: "85%" }}>
                  <ToolChip tool={b} />
                </div>
              ) : b.content ? (
                <div key={j} style={msgBubble(m.role)}>
                  <MdContent text={b.content} />
                </div>
              ) : null
            ))}
          </React.Fragment>
        ))}

        {/* Status indicator */}
        {busy && streamBlocks.length === 0 && (
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
            <span>{thinking ? "Thinking" : "Waiting for response"}</span>
          </div>
        )}

        {/* Live streaming blocks — interleaved tool calls and text */}
        {streamBlocks.map((b, j) => (
          b.type === "tool" ? (
            <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: "85%" }}>
              <ToolChip tool={b} live={!b.output} />
            </div>
          ) : b.content ? (
            <div key={j} style={msgBubble("assistant")}>
              <MdContent text={b.content} />
            </div>
          ) : null
        ))}

        {/* Error */}
        {error && (
          <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} style={{
        padding: "12px 1.5rem",
        borderTop: "1px solid var(--border)",
        display: "flex",
        gap: "8px",
        flexShrink: 0,
      }}>
        <input
          style={inputStyle}
          placeholder={busy ? "Waiting for response..." : "Type a message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit" style={{ ...btnPrimary, opacity: busy ? 0.5 : 1 }} disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
