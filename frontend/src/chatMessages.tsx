import React, { useCallback, useState } from "react";
import { FileText, Pencil, RotateCw, Copy, Check } from "lucide-react";
import { input as inputStyle, btnPrimary } from "./styles";
import { MdContent, ToolChip } from "./chatUi";
import type { Attachment } from "./api";
import type { ApprovalScope, DisplayMessage, StreamBlock } from "./chatState";
import { buildLiveMessageRows } from "./chatMessagesState";

const MESSAGE_MAX_WIDTH = "92%";
const CHAT_MESSAGES_MAX_WIDTH = "64rem";

interface ChatMessagesProps {
  projectId?: string;
  messages: DisplayMessage[];
  streamBlocks: StreamBlock[];
  activeAgent: { id: string; name: string; color?: string } | null;
  connected: boolean;
  waitingForModel: boolean;
  error: string | null;
  voiceError: string | null;
  hasMoreHistory: boolean;
  loadingOlder: boolean;
  bottomSlackPx: number;
  autonomousToolsEnabled: boolean;
  messageListRef: React.RefObject<HTMLDivElement | null>;
  pendingScrollMessageIdRef: React.RefObject<string | null>;
  lastSentMessageRef: React.RefObject<HTMLDivElement | null>;
  latestUserMessageRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlderHistory: () => void;
  onOpenFile: (path: string) => void;
  onToolApproval: (toolCallId: string, approved: boolean, scope?: ApprovalScope) => void;
  resend: (text: string) => void;
}

export function ChatMessages({
  projectId,
  messages,
  streamBlocks,
  activeAgent,
  connected,
  waitingForModel,
  error,
  voiceError,
  hasMoreHistory,
  loadingOlder,
  bottomSlackPx,
  autonomousToolsEnabled,
  messageListRef,
  pendingScrollMessageIdRef,
  lastSentMessageRef,
  latestUserMessageRef,
  onLoadOlderHistory,
  onOpenFile,
  onToolApproval,
  resend,
}: ChatMessagesProps) {
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);

  const msgBubble = useCallback((role: "user" | "assistant", agentColor?: string, bashMode?: boolean): React.CSSProperties => ({
    maxWidth: MESSAGE_MAX_WIDTH,
    padding: "10px 14px",
    borderRadius: "12px",
    marginBottom: "2px",
    fontSize: "0.9rem",
    wordBreak: "break-word",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    position: "relative",
    zIndex: 0,
    background: role === "user"
      ? (bashMode ? "var(--bg-bash-user)" : "var(--bg-user)")
      : "var(--bg-surface)",
    color: "var(--text)",
    border: `1px solid ${role === "user" ? (bashMode ? "var(--border-bash-user)" : "var(--border-user)") : "var(--border)"}`,
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

  const renderAgentLabel = (name?: string, color?: string) => name ? (
    <div style={{
      fontSize: "0.7rem",
      fontWeight: 600,
      color: color || "var(--text-muted)",
      marginTop: "6px",
      marginBottom: "1px",
      alignSelf: "flex-start",
      display: "flex",
      alignItems: "center",
      gap: "4px",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color || "var(--text-muted)", display: "inline-block" }} />
      {name}
    </div>
  ) : null;

  return (
    <div ref={messageListRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "4px", maxWidth: CHAT_MESSAGES_MAX_WIDTH, width: "100%", margin: "0 auto", flex: 1 }}>
        {hasMoreHistory && (
          <div style={{ alignSelf: "center", marginBottom: "8px" }}>
            <button type="button" onClick={onLoadOlderHistory} disabled={loadingOlder} style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "999px", padding: "6px 12px", fontSize: "0.8rem", cursor: loadingOlder ? "default" : "pointer", opacity: loadingOlder ? 0.7 : 1 }}>
              {loadingOlder ? "Loading older messages…" : "Load older messages"}
            </button>
          </div>
        )}
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {m.role === "assistant" && renderAgentLabel(m.agent_name, m.agent_color)}
            {m.blocks.map((b, j) => (
              b.type === "tool" ? (
                <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: MESSAGE_MAX_WIDTH }}>
                  <ToolChip tool={b} defaultOpen={!!m.defaultExpandedTools} onOpenFile={onOpenFile} onRespond={onToolApproval} autonomousToolsEnabled={autonomousToolsEnabled} />
                </div>
              ) : b.type === "system" ? (
                <div key={j} style={{ alignSelf: "center", fontSize: "0.8rem", color: b.tone === "error" ? "#c4554d" : "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "999px", padding: "6px 10px", margin: "6px 0", maxWidth: "100%" }}>
                  {b.content}
                </div>
              ) : b.type === "text" && b.content ? (
                m.role === "assistant" ? (
                  <div key={j} style={{ position: "relative", maxWidth: MESSAGE_MAX_WIDTH, alignSelf: "flex-start" }}>
                    <div style={{ ...msgBubble("assistant", m.agent_color), maxWidth: "100%", paddingRight: "42px" }}>
                      <MdContent text={b.content} />
                    </div>
                    <button onClick={() => copyAssistantMessage(i, b.content)} data-tooltip={copiedMsgIdx === i ? "Copied!" : "Copy message"} style={assistantCopyBtnStyle} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}>
                      {copiedMsgIdx === i ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <div key={j} ref={(el) => {
                    if (m.message_id === pendingScrollMessageIdRef.current) lastSentMessageRef.current = el;
                    if (m.role === "user" && i === messages.length - 1) latestUserMessageRef.current = el;
                  }} data-message-id={m.message_id} style={{ ...msgBubble(m.role, m.agent_color, m.bashMode), opacity: m.pending ? 0.7 : 1 }}>
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: b.content ? "8px" : 0 }}>
                        {m.attachments.map((attachment: Attachment) => attachment.kind === "image" ? (
                          <button key={attachment.path} onClick={() => onOpenFile(attachment.path)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                            <img src={`/api/projects/${projectId}/file/raw?path=${encodeURIComponent(attachment.path)}`} alt={attachment.name} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: "1px solid var(--border)", objectFit: "cover", display: "block" }} />
                          </button>
                        ) : (
                          <button key={attachment.path} onClick={() => onOpenFile(attachment.path)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "var(--text)", fontSize: "0.78rem" }}>
                            <FileText size={14} /> {attachment.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {editingMsgIdx === i ? (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        const text = editingMsgValue.trim();
                        if (text) {
                          setEditingMsgIdx(null);
                          resend(text);
                        }
                      }} style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
                        <input autoFocus value={editingMsgValue} onChange={(e) => setEditingMsgValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEditingMsgIdx(null); }} style={{ ...inputStyle, background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "inherit", fontSize: "inherit" }} />
                        <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                          <button type="button" onClick={() => setEditingMsgIdx(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer" }}>Cancel</button>
                          <button type="submit" style={{ ...btnPrimary, fontSize: "0.75rem", padding: "2px 8px", borderRadius: "6px" }}>Send</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <MdContent text={b.content} />
                        {m.pending && <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 6 }}>Sending…</div>}
                      </>
                    )}
                  </div>
                )
              ) : null
            ))}
            {m.role === "user" && editingMsgIdx !== i && (
              <div style={{ alignSelf: "flex-end", display: "flex", gap: "2px", marginTop: "-2px", marginBottom: "2px", minHeight: "20px", visibility: waitingForModel ? "hidden" : "visible", pointerEvents: waitingForModel ? "none" : "auto" }}>
                <button onClick={() => {
                  const text = m.blocks.find((b) => b.type === "text")?.content || "";
                  setEditingMsgIdx(i);
                  setEditingMsgValue(text);
                }} data-tooltip="Edit & resend" style={{ background: "none", border: "none", padding: "2px", color: "var(--text-muted)", cursor: "pointer", opacity: 0.4, display: "inline-flex", alignItems: "center" }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}>
                  <Pencil size={12} />
                </button>
                <button onClick={() => {
                  const text = m.blocks.find((b) => b.type === "text")?.content || "";
                  if (text) resend(text);
                }} data-tooltip="Rerun" style={{ background: "none", border: "none", padding: "2px", color: "var(--text-muted)", cursor: "pointer", opacity: 0.4, display: "inline-flex", alignItems: "center" }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}>
                  <RotateCw size={12} />
                </button>
              </div>
            )}
          </React.Fragment>
        ))}

        {buildLiveMessageRows(connected, streamBlocks, activeAgent).map((m, idx) => (
          <React.Fragment key={`live-${idx}`}>
            {renderAgentLabel(m.agent_name, m.agent_color)}
            {m.blocks.map((b, j) => (
              b.type === "tool" ? (
                <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: MESSAGE_MAX_WIDTH }}>
                  <ToolChip tool={b} live={!!m.live && !b.output} defaultOpen={false} onOpenFile={onOpenFile} onRespond={onToolApproval} autonomousToolsEnabled={autonomousToolsEnabled} />
                </div>
              ) : b.type === "system" ? (
                <div key={j} style={{ alignSelf: "center", fontSize: "0.8rem", color: b.tone === "error" ? "#c4554d" : "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "999px", padding: "6px 10px", margin: "6px 0", maxWidth: "100%" }}>{b.content}</div>
              ) : b.type === "text" && b.content ? (
                <div key={j} style={{ position: "relative", maxWidth: MESSAGE_MAX_WIDTH, alignSelf: "flex-start" }}>
                  <div style={{ ...msgBubble("assistant", m.agent_color), maxWidth: "100%", paddingRight: "42px" }}><MdContent text={b.content} /></div>
                  <button onClick={() => navigator.clipboard.writeText(b.content)} data-tooltip="Copy message" style={assistantCopyBtnStyle} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}><Copy size={12} /></button>
                </div>
              ) : null
            ))}
          </React.Fragment>
        ))}

        {waitingForModel && (
          <div style={{ alignSelf: "flex-start", padding: "10px 14px", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
            <span style={{ display: "inline-flex", gap: "5px", fontSize: "1.05rem", fontWeight: 600, lineHeight: 1, opacity: 0.9 }}>
              <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0s" }}>•</span>
              <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.2s" }}>•</span>
              <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.4s" }}>•</span>
            </span>
          </div>
        )}

        {error && <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>{error}</div>}
        {voiceError && <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>{voiceError}</div>}

        <div style={{ flexShrink: 0, height: `${bottomSlackPx}px`, pointerEvents: "none" }} />
      </div>
    </div>
  );
}
