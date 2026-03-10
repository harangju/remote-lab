import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getConvo, connectWs, type ConvoDetail, type WsEvent } from "../api";
import { container, backLink, input as inputStyle, btnPrimary } from "../styles";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

interface MetaInfo {
  cost: number;
  turns: number;
}

export function Chat() {
  const { projectId, convId } = useParams<{ projectId: string; convId: string }>();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, streaming, scrollToBottom]);

  // Load existing messages
  useEffect(() => {
    if (!convId) return;
    getConvo(convId)
      .then((detail) => {
        const msgs: DisplayMessage[] = detail.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        setMessages(msgs);
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
        case "text-delta":
          setStreaming((prev) => prev + data.delta);
          break;
        case "tool-use":
          setTools((prev) => [...prev, data.name]);
          break;
        case "done":
          // Finalize the streamed message
          setStreaming((prev) => {
            if (prev) {
              setMessages((msgs) => [...msgs, { role: "assistant", content: prev, tools: [...tools] }]);
            }
            return "";
          });
          setTools([]);
          setMeta({ cost: data.cost, turns: data.turns });
          setBusy(false);
          break;
        case "error":
          setError(data.message);
          setStreaming((prev) => {
            if (prev) {
              setMessages((msgs) => [...msgs, { role: "assistant", content: prev }]);
            }
            return "";
          });
          setTools([]);
          setBusy(false);
          break;
      }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
    });

    ws.addEventListener("error", () => {
      setError("WebSocket connection error");
      setConnected(false);
    });

    return () => {
      ws.close();
    };
  }, [convId]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !wsRef.current) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setMeta(null);
    setError(null);
    wsRef.current.send(text);
  };

  // Styles
  const msgBubble = (role: "user" | "assistant"): React.CSSProperties => ({
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "12px",
    marginBottom: "8px",
    fontSize: "0.9rem",
    lineHeight: "1.5",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? "var(--accent)" : "var(--bg-surface)",
    color: role === "user" ? "#fff" : "var(--text)",
    border: role === "user" ? "none" : "1px solid var(--border)",
  });

  const toolChip: React.CSSProperties = {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    padding: "2px 0",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", maxWidth: "48rem", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "12px 1.5rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Link to={`/p/${projectId}`} style={backLink}>&larr; Conversations</Link>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600 }}>Chat</span>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: connected ? "#3fb950" : "#8b949e",
            display: "inline-block",
          }} />
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "4px" }}>
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            <div style={msgBubble(m.role)}>{m.content}</div>
            {m.tools && m.tools.length > 0 && (
              <div style={{ ...toolChip, alignSelf: "flex-start" }}>
                {m.tools.map((t, j) => (
                  <span key={j} style={{ marginRight: "8px" }}>tool: {t}</span>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}

        {/* Currently streaming */}
        {streaming && <div style={msgBubble("assistant")}>{streaming}</div>}

        {/* Tool use while streaming */}
        {tools.length > 0 && (
          <div style={{ ...toolChip, alignSelf: "flex-start" }}>
            {tools.map((t, j) => (
              <span key={j} style={{ marginRight: "8px" }}>tool: {t}</span>
            ))}
          </div>
        )}

        {/* Meta info */}
        {meta && (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center", margin: "8px 0" }}>
            {meta.turns} turn{meta.turns !== 1 ? "s" : ""} &middot; ${meta.cost.toFixed(4)}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: "0.8rem", color: "#f85149", textAlign: "center", margin: "8px 0" }}>
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
          disabled={busy}
          autoFocus
        />
        <button type="submit" style={{ ...btnPrimary, opacity: busy ? 0.5 : 1 }} disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
