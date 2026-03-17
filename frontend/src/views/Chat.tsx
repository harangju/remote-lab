import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal, FileText, Pencil, Search, Settings, ChevronDown, ChevronUp, Minimize2, Globe, ExternalLink, FolderOpen, Square, RotateCw, ShieldCheck, ShieldX, Copy, Check, Sparkles, Paperclip, X, Mic, ArrowUp } from "lucide-react";
import { getConvo, updateConvo, connectWs, listProjectAgents, listFiles, listSkills, uploadFiles, type WsEvent, type AgentConfig, type Skill, type Attachment, type ConvoDetail } from "../api";
import { input as inputStyle, btnPrimary, btnIcon } from "../styles";

const headerIconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

function headerHoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--bg-surface) 88%, var(--accent) 12%)";
}

function headerHoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--bg-surface)";
}
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
  liveOutput?: string;
}

type ApprovalScope = "once" | "project";

type StreamBlock =
  | { type: "text"; content: string }
  | { type: "tool"; name: string; input?: string; output?: string; liveOutput?: string; tool_call_id?: string; awaitingApproval?: boolean; approvalStatus?: "pending" | "approved" | "denied"; canAllowProject?: boolean; approvedScope?: ApprovalScope }
  | { type: "system"; content: string; tone?: "error" | "info" };

interface DisplayMessage {
  role: "user" | "assistant" | "system";
  blocks: StreamBlock[];
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
  message_id?: string;
  pending?: boolean;
  attachments?: Attachment[];
  bashMode?: boolean;
  defaultExpandedTools?: boolean;
}

interface PendingMessage {
  message_id: string;
  text: string;
  attachments?: Attachment[];
}

interface ComposerAttachment {
  file: File;
  previewUrl?: string;
}

interface MetaInfo {
  turns: number;
  context_tokens: number;
  context_limit: number;
}

// ---------------------------------------------------------------------------
// ContextDonut — small SVG ring showing context window usage
// ---------------------------------------------------------------------------

function formatTokenCount(value: number, digits = 1): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${parseFloat(millions.toFixed(digits))}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${parseFloat(thousands.toFixed(digits))}k`;
  }
  return `${value}`;
}

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
      data-tooltip={`${formatTokenCount(tokens)} / ${formatTokenCount(limit, 0)} tokens (${Math.round(pct * 100)}%)`}
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
function parseToolInput(input?: string): Record<string, any> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
  } catch {}
  return null;
}

function toolSummary(name: string, input?: string): string | null {
  if (!input) return null;
  const parsed = parseToolInput(input);
  if (["read_file", "write_file", "edit_file"].includes(name)) {
    const path = typeof parsed?.path === "string" ? parsed.path : undefined;
    const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return path || (pathMatch ? pathMatch[1] : input.slice(0, 60));
  }
  if (name === "bash") {
    const command = typeof parsed?.command === "string" ? parsed.command : input;
    return command.length > 60 ? command.slice(0, 57) + "..." : command;
  }
  if (name === "glob" || name === "grep") {
    const pattern = typeof parsed?.pattern === "string" ? parsed.pattern : undefined;
    const patMatch = input.match(/['"]?pattern['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return pattern || (patMatch ? patMatch[1] : input.slice(0, 60));
  }
  return input.length > 60 ? input.slice(0, 57) + "..." : input;
}

/** Extract file path from tool input. */
function extractFilePath(name: string, input?: string): string | null {
  if (!input || !["read_file", "write_file", "edit_file"].includes(name)) return null;
  const parsed = parseToolInput(input);
  if (typeof parsed?.path === "string") return parsed.path;
  const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
  return pathMatch ? pathMatch[1] : input.trim();
}

function extractShareUrl(name: string, input?: string): string | null {
  if (name !== "share" || !input) return null;
  const mdMatch = input.match(/\((https?:\/\/[^)\s]+)\)/);
  if (mdMatch) return mdMatch[1];
  const plainMatch = input.match(/https?:\/\/\S+/);
  return plainMatch ? plainMatch[0] : null;
}

function ToolChip({ tool, live, defaultOpen = false, onOpenFile, onRespond }: {
  tool: ToolCall & { tool_call_id?: string; awaitingApproval?: boolean; approvalStatus?: "pending" | "approved" | "denied"; canAllowProject?: boolean; approvedScope?: ApprovalScope };
  live?: boolean;
  defaultOpen?: boolean;
  onOpenFile?: (path: string) => void;
  onRespond?: (toolCallId: string, approved: boolean, scope?: ApprovalScope) => void;
}) {
  const [manualOpen, setManualOpen] = useState(defaultOpen);
  const preRef = useRef<HTMLPreElement>(null);
  const Icon = toolIcons[tool.name] || Settings;
  const hasDetail = !!(tool.input || tool.output);
  const summary = toolSummary(tool.name, tool.input);
  const filePath = extractFilePath(tool.name, tool.input);
  const shareUrl = extractShareUrl(tool.name, tool.input) || extractShareUrl(tool.name, tool.output);
  const isFileOp = !!filePath;
  const isShareLink = !!shareUrl;
  const approvalPending = !!tool.awaitingApproval && tool.approvalStatus !== "approved" && tool.approvalStatus !== "denied";
  const approvalDenied = tool.approvalStatus === "denied";
  const approvalApproved = tool.approvalStatus === "approved";
  const showStatusSlot = live || !!tool.output || approvalPending || approvalDenied || approvalApproved || (isFileOp && !!onOpenFile) || isShareLink;
  const isStreaming = !!(live && tool.liveOutput);
  const open = isStreaming || manualOpen;
  const displayContent = isStreaming ? tool.liveOutput : (tool.output || "");

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isStreaming && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [isStreaming, tool.liveOutput]);

  const handleOpenFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath && onOpenFile) onOpenFile(filePath);
  };

  const handleOpenShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (shareUrl) window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", flexShrink: 0, maxWidth: "100%" }}>
      <button
        onClick={() => hasDetail && setManualOpen(!manualOpen)}
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
          flexWrap: "nowrap",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
          textAlign: "left",
          minHeight: "28px",
        }}
      >
        <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={13} />
        </span>
        <span style={{ fontFamily: "monospace", flexShrink: 0 }}>{tool.name}</span>
        {summary && (
          <span style={{
            fontFamily: "monospace",
            opacity: 0.7,
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
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
          ) : approvalPending ? (
            <span style={{ opacity: 0.7, lineHeight: 1, color: "var(--accent)" }} title="Waiting for approval">!</span>
          ) : approvalDenied ? (
            <span style={{ opacity: 0.7, lineHeight: 1, color: "#c4554d" }} title="Denied">×</span>
          ) : approvalApproved ? (
            <span style={{ opacity: 0.5, lineHeight: 1 }}>&#10003;</span>
          ) : isShareLink ? (
            <span
              onClick={handleOpenShare}
              style={{ display: "inline-flex", alignItems: "center", opacity: 0.5 }}
              data-tooltip="Open published page"
            >
              <ExternalLink size={12} />
            </span>
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
      {approvalPending && tool.tool_call_id && onRespond && (
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "6px 10px",
          marginTop: "4px",
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          alignItems: "center",
        }}>
          <button onClick={() => onRespond(tool.tool_call_id!, true, "once")} style={{ ...btnPrimary, fontSize: "0.75rem", padding: "4px 8px", borderRadius: "6px" }}>Allow once</button>
          {tool.canAllowProject && (
            <button onClick={() => onRespond(tool.tool_call_id!, true, "project")} style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "6px", padding: "4px 8px", fontSize: "0.75rem", cursor: "pointer" }}>Allow in project</button>
          )}
          <button onClick={() => onRespond(tool.tool_call_id!, false, "once")} style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "6px", padding: "4px 8px", fontSize: "0.75rem", cursor: "pointer" }}>Deny</button>
        </div>
      )}
      {open && (hasDetail || isStreaming) && (
        <pre ref={preRef} style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "6px 10px",
          marginTop: "4px",
          fontSize: "0.75rem",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          maxWidth: "100%",
          maxHeight: isStreaming ? "5lh" : "200px",
          overflowX: "hidden",
          overflowY: "auto",
          color: "var(--text)",
        }}>{isStreaming ? displayContent : (tool.input ? tool.input + (tool.output ? "\n---\n" : "") : "") + (tool.output || "")}</pre>
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
      <div style={{ overflowX: "auto", margin: "6px 0" }}>
        <table style={{
          borderCollapse: "collapse",
          width: "100%",
          minWidth: "max-content",
          fontSize: "0.85rem",
        }}>{children}</table>
      </div>
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
// Live file-change sync test marker 2
// ---------------------------------------------------------------------------

const MIN_USER_MESSAGE_TOP_OFFSET_PX = 24;
const MAX_USER_MESSAGE_TOP_OFFSET_PX = 72;
const USER_MESSAGE_TOP_OFFSET_VH = 0.08;
const MIN_BOTTOM_SLACK_PX = 80;
const BOTTOM_SLACK_VH = 0.12;
const CHAT_HEADER_MAX_WIDTH = "64rem";
const CHAT_MESSAGES_MAX_WIDTH = "64rem";
const CHAT_INPUT_MAX_WIDTH = "64rem";
const MESSAGE_MAX_WIDTH = "92%";
const INITIAL_HISTORY_PAGE_SIZE = 100;
const OLDER_HISTORY_PAGE_SIZE = 100;

function blockIdentity(block: StreamBlock): string {
  if (block.type === "tool") return `tool:${block.tool_call_id || block.name}:${block.input || ""}:${block.output || ""}`;
  if (block.type === "text") return `text:${block.content}`;
  return `system:${block.tone || "info"}:${block.content}`;
}

function messageIdentity(message: DisplayMessage): string {
  return `${message.role}:${message.agent_id || ""}:${message.blocks.map(blockIdentity).join("|")}`;
}

function buildDisplayMessages(detail: ConvoDetail, agentList: AgentConfig[]): { messages: DisplayMessage[]; meta: MetaInfo | null; title: string; autonomousToolsEnabled: boolean } {
  const msgs: DisplayMessage[] = [];
  let pendingBlocks: StreamBlock[] = [];
  const toolIndexById = new Map<string, number>();

  const flushPending = () => {
    if (pendingBlocks.length > 0) {
      msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
      pendingBlocks = [];
      toolIndexById.clear();
    }
  };

  for (const m of detail.messages) {
    const mAny = m as any;
    const type = mAny.type;

    if (type === "tool-call") {
      pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, tool_call_id: mAny.tool_call_id || undefined });
      if (mAny.tool_call_id) toolIndexById.set(mAny.tool_call_id, pendingBlocks.length - 1);
      continue;
    }

    if (type === "tool-output") {
      if (!mAny.tool_call_id) continue;
      const idx = toolIndexById.get(mAny.tool_call_id);
      if (idx != null && pendingBlocks[idx]?.type === "tool") {
        const existing = pendingBlocks[idx];
        pendingBlocks[idx] = { ...existing, liveOutput: `${existing.liveOutput || ""}${mAny.output || ""}` };
      }
      continue;
    }

    if (type === "tool-result") {
      if (!mAny.tool_call_id) {
        flushPending();
        pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output });
        continue;
      }
      const idx = toolIndexById.get(mAny.tool_call_id);
      if (idx != null && pendingBlocks[idx]?.type === "tool") {
        const existing = pendingBlocks[idx];
        pendingBlocks[idx] = { ...existing, output: mAny.output ?? existing.liveOutput ?? existing.output, input: mAny.input ?? existing.input, liveOutput: undefined };
      } else {
        pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output, tool_call_id: mAny.tool_call_id || undefined });
      }
      continue;
    }

    if (type === "run-error" || type === "system") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.message || mAny.content || "", tone: type === "run-error" ? "error" : "info" }] });
      continue;
    }

    if (type === "compacted") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.output || mAny.message || mAny.content || "Conversation compacted", tone: "info" }] });
      continue;
    }

    if (type === "skill-result") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.output || "", tone: "info" }] });
      continue;
    }

    if (type === "user-message" || mAny.role === "user") {
      flushPending();
      msgs.push({
        role: "user",
        blocks: [{ type: "text", content: typeof mAny.content === "string" ? mAny.content : JSON.stringify(mAny.content) }],
        message_id: typeof mAny.message_id === "string" ? mAny.message_id : undefined,
        pending: false,
        attachments: Array.isArray(mAny.attachments) ? mAny.attachments : undefined,
        bashMode: !!mAny.bash_mode,
      });
      continue;
    }

    if (type === "assistant-message" || mAny.role === "assistant") {
      const content = typeof mAny.content === "string" ? mAny.content : JSON.stringify(mAny.content);
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
      toolIndexById.clear();
      continue;
    }

    if (mAny.role === "tool") {
      pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output, tool_call_id: mAny.tool_call_id || undefined });
      if (mAny.tool_call_id) toolIndexById.set(mAny.tool_call_id, pendingBlocks.length - 1);
    }
  }

  flushPending();

  return {
    messages: msgs,
    meta: detail.context_limit > 0 ? {
      turns: 0,
      context_tokens: detail.context_tokens,
      context_limit: detail.context_limit,
    } : null,
    title: detail.title || "Untitled",
    autonomousToolsEnabled: !!detail.autonomous_tools_enabled,
  };
}

export function Chat() {
  const { projectId, convId } = useParams<{ projectId: string; convId: string }>();
  const navigate = useNavigate();
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
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [voiceUiActive, setVoiceUiActive] = useState(false);
  const [voiceElapsedSec, setVoiceElapsedSec] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceBaseText, setVoiceBaseText] = useState("");
  const [voiceTranscriptText, setVoiceTranscriptText] = useState("");
  const [voiceStatusText, setVoiceStatusText] = useState("Listening…");
  const activeAgentRef = useRef<{ id: string; name: string; color?: string } | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<PendingMessage[]>([]);
  const flushingQueueRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const lastSentMessageRef = useRef<HTMLDivElement | null>(null);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<StreamBlock[]>([]);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Panel hook
  const panel = usePanel(projectId);

  const syncFileQuery = useCallback((path: string | null, replace = false) => {
    if (!projectId || !convId) return;
    const nextUrl = path
      ? `/${projectId}/${convId}?path=${encodeURIComponent(path)}`
      : `/${projectId}/${convId}`;
    navigate(nextUrl, { replace });
  }, [convId, navigate, projectId]);

  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const prependScrollRestoreRef = useRef<number | null>(null);

  const getUserMessageTopOffsetPx = useCallback(() => {
    const viewportOffset = window.innerHeight * USER_MESSAGE_TOP_OFFSET_VH;
    return Math.max(MIN_USER_MESSAGE_TOP_OFFSET_PX, Math.min(MAX_USER_MESSAGE_TOP_OFFSET_PX, viewportOffset));
  }, []);

  const bottomSlackPx = useMemo(() => {
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    return Math.max(MIN_BOTTOM_SLACK_PX, viewportHeight * BOTTOM_SLACK_VH);
  }, []);

  const scrollUserMessageNearTop = useCallback((messageEl: HTMLDivElement | null, behavior: ScrollBehavior = "smooth") => {
    const container = messageListRef.current;
    if (!container || !messageEl) return;
    const targetTop = messageEl.offsetTop - getUserMessageTopOffsetPx();
    container.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, [getUserMessageTopOffsetPx]);

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
        ws.send(JSON.stringify({ type: "user-message", message_id: pending.message_id, text: pending.text, attachments: pending.attachments || [] }));
      }
    } finally {
      flushingQueueRef.current = false;
    }
  }, []);

  const setCurrentRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const queueMessage = useCallback((text: string, attachments: Attachment[] = []) => {
    const message_id = crypto.randomUUID();
    const entry = { message_id, text, attachments };
    syncPendingMessages((prev) => [...prev, entry]);
    setMessages((prev) => [...prev, {
      role: "user",
      blocks: [{ type: "text", content: text }],
      message_id,
      pending: true,
      attachments,
      bashMode: text.startsWith("!"),
    }]);
    setBusy(true);
    setWaitingForModel(true);
    setError(null);
    return message_id;
  }, [syncPendingMessages]);

  const addComposerFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setComposerAttachments((prev) => [...prev, ...next]);
  }, []);

  const removeComposerAttachment = useCallback((idx: number) => {
    setComposerAttachments((prev) => {
      const item = prev[idx];
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  useLayoutEffect(() => {
    if (prependScrollRestoreRef.current != null && messageListRef.current) {
      const container = messageListRef.current;
      const prevHeight = prependScrollRestoreRef.current;
      const nextHeight = container.scrollHeight;
      container.scrollTop += nextHeight - prevHeight;
      prependScrollRestoreRef.current = null;
      return;
    }
    if (!pendingScrollMessageIdRef.current) return;
    const messageEl = lastSentMessageRef.current;
    if (!messageEl || messageEl.dataset.messageId !== pendingScrollMessageIdRef.current) return;
    scrollUserMessageNearTop(messageEl);
    pendingScrollMessageIdRef.current = null;
  }, [messages, scrollUserMessageNearTop]);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path");
    const prefill = params.get("prefill");
    if (path) {
      if (!panel.file || panel.file.path !== path) panel.openFile(path);
    } else if (panel.file && !panel.dirty) {
      panel.forceClose();
    }
    if (prefill) {
      setInput(prefill);
      requestAnimationFrame(() => inputRef.current?.focus());
      params.delete("prefill");
      const nextUrl = params.toString() ? `/${projectId}/${convId}?${params.toString()}` : `/${projectId}/${convId}`;
      navigate(nextUrl, { replace: true });
    }
  }, [panel, projectId, convId, navigate]);

  /** Open a file in the panel, with dirty guard. */
  const handleOpenFile = useCallback((path: string) => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard and open another file?")) return;
    }
    syncFileQuery(path);
    panel.openFile(path);
  }, [panel, syncFileQuery]);

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
    syncFileQuery(null);
    panel.forceClose();
  }, [panel, syncFileQuery]);

  /** Toggle edit mode with dirty guard when turning off. */
  const handleToggleEdit = useCallback(() => {
    if (panel.editMode && panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
      panel.cancelEdit();
    } else {
      panel.setEditMode(!panel.editMode);
    }
  }, [panel]);

  useLayoutEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0 || messageListRef.current == null) return;
    requestAnimationFrame(() => {
      const container = messageListRef.current;
      if (!container) return;
      if (latestUserMessageRef.current) {
        scrollUserMessageNearTop(latestUserMessageRef.current, "auto");
      } else {
        container.scrollTop = container.scrollHeight;
      }
      initialScrollDoneRef.current = true;
    });
  }, [messages.length, scrollUserMessageNearTop]);

  const reloadConversation = useCallback(async () => {
    if (!convId || !projectId) return;
    const [detail, agentRes] = await Promise.all([
      getConvo(convId, { limit: INITIAL_HISTORY_PAGE_SIZE }),
      listProjectAgents(projectId),
    ]);
    const agentList = agentRes.agents;
    setAgents(agentList);
    const rebuilt = buildDisplayMessages(detail, agentList);
    setTitle(rebuilt.title);
    setAutonomousToolsEnabled(rebuilt.autonomousToolsEnabled);
    setHasMoreHistory(detail.has_more);
    setHistoryCursor(detail.next_before);
    setMessages((prev) => {
      const rebuiltIds = new Set(rebuilt.messages.map(messageIdentity));
      const pendingOnly = prev.filter((msg) => msg.pending || !rebuiltIds.has(messageIdentity(msg)));
      return [...rebuilt.messages, ...pendingOnly.filter((msg) => msg.pending)];
    });
    setMeta(rebuilt.meta);
    blocksRef.current = [];
    setStreamBlocks([]);
    activeAgentRef.current = null;
    setActiveAgent(null);
    initialScrollDoneRef.current = false;
  }, [convId, projectId]);

  const loadOlderHistory = useCallback(async () => {
    if (!convId || loadingOlder || !hasMoreHistory || historyCursor == null) return;
    setLoadingOlder(true);
    try {
      const detail = await getConvo(convId, { before: historyCursor, limit: OLDER_HISTORY_PAGE_SIZE });
      const rebuilt = buildDisplayMessages(detail, agents);
      if (messageListRef.current) prependScrollRestoreRef.current = messageListRef.current.scrollHeight;
      setMessages((prev) => {
        const prevIds = new Set(prev.map(messageIdentity));
        const olderOnly = rebuilt.messages.filter((msg) => !prevIds.has(messageIdentity(msg)));
        return [...olderOnly, ...prev];
      });
      setHasMoreHistory(detail.has_more);
      setHistoryCursor(detail.next_before);
    } catch (e: any) {
      setError(e.message || "Failed to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  }, [convId, loadingOlder, hasMoreHistory, historyCursor, agents]);

  // Load agent configs + existing messages together so agent labels resolve
  useEffect(() => {
    reloadConversation().catch((e) => setError(e.message));
  }, [reloadConversation]);

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
    let cancelled = false;
    const clearConnectionOnlyState = () => {
      setThinking(false);
      setWaitingForModel(false);
      setCurrentRunId(null);
      setBusy(false);
    };
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
          reloadConversation().catch((e) => {
            if (!cancelled) setError(e.message);
          });
          flushPendingQueue();
          break;
        case "message-ack":
          syncPendingMessages((prev) => prev.filter((msg) => msg.message_id !== data.message_id));
          markMessagePending(data.message_id, false);
          setError(null);
          break;
        case "voice-state":
          if (data.state === "starting") {
            setVoiceError(null);
            setVoiceStatusText("Starting microphone…");
            setVoiceUiActive(true);
          } else if (data.state === "listening") {
            setVoiceStatusText("Listening…");
            setVoiceUiActive(true);
          } else if (data.state === "stopped") {
            setVoiceStatusText("Listening…");
            setVoiceUiActive(false);
          }
          break;
        case "voice-transcript":
          setVoiceTranscriptText(data.text);
          setInput(`${voiceBaseText}${voiceBaseText && data.text ? " " : ""}${data.text}`);
          break;
        case "running":
          setCurrentRunId(data.run_id);
          setBusy(true);
          setWaitingForModel(true);
          break;
        case "agent-start": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const ag = { id: data.agent_id, name: data.agent_name, color: data.agent_color };
          activeAgentRef.current = ag;
          setActiveAgent(ag);
          break;
        }
        case "thinking-delta":
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setThinking(true);
          break;
        case "text-delta": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
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
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(false);
          const blocks = [...blocksRef.current];
          let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              blocks[i] = {
                ...b,
                input: data.input ?? b.input,
                awaitingApproval: false,
                approvalStatus: b.approvalStatus === "denied" ? b.approvalStatus : undefined,
              };
              matched = true;
              break;
            }
          }
          if (!matched) {
            blocks.push({ type: "tool", name: data.name, input: data.input, tool_call_id: data.tool_call_id });
          }
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-output": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const oBlocks = [...blocksRef.current];
          for (let i = oBlocks.length - 1; i >= 0; i--) {
            const b = oBlocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              oBlocks[i] = { ...b, liveOutput: (b.liveOutput || "") + data.output };
              break;
            }
          }
          blocksRef.current = oBlocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "tool-result": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(true);
          const blocks = [...blocksRef.current];
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              blocks[i] = { ...b, output: b.liveOutput || data.output, liveOutput: undefined };
              break;
            }
          }
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "file-changed": {
          panel.applyExternalChange(data.path);
          break;
        }
        case "tool-confirm": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(false);
          const blocks = [...blocksRef.current];
          blocks.push({
            type: "tool",
            tool_call_id: data.tool_call_id,
            name: data.name,
            input: data.args,
            awaitingApproval: true,
            approvalStatus: "pending",
            canAllowProject: data.can_allow_project !== false,
          });
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "done": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const finalBlocks = blocksRef.current;
          if (finalBlocks.length > 0) {
            const ag = activeAgentRef.current;
            const onlyBashOutput = finalBlocks.length > 0 && finalBlocks.every((b) => b.type === "tool" && b.name === "bash" && !!b.output);
            const finalMessage: DisplayMessage = {
              role: "assistant",
              blocks: [...finalBlocks],
              agent_id: data.agent_id || ag?.id,
              agent_name: ag?.name,
              agent_color: ag?.color,
              defaultExpandedTools: onlyBashOutput,
            };
            setMessages((msgs) => msgs.some((msg) => messageIdentity(msg) === messageIdentity(finalMessage)) ? msgs : [...msgs, finalMessage]);
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
          setCurrentRunId(null);
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
          if (!data.run_id && data.message.startsWith("Voice input failed")) {
            setVoiceError(data.message);
            setVoiceUiActive(false);
            break;
          }
          if (data.run_id && activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setError(data.message);
          if (blocksRef.current.length > 0) {
            const finalMessage: DisplayMessage = { role: "assistant", blocks: [...blocksRef.current] };
            setMessages((msgs) => msgs.some((msg) => messageIdentity(msg) === messageIdentity(finalMessage)) ? msgs : [...msgs, finalMessage]);
          }
          blocksRef.current = [];
          setStreamBlocks([]);
          setThinking(false);
          setWaitingForModel(false);
          activeAgentRef.current = null;
          setActiveAgent(null);
          setBusy(false);
          setCurrentRunId(null);
          if (data.recoverable && convId) {
            reloadConversation().catch((e) => setError(e.message));
          }
          break;
      }
    });

    ws.addEventListener("close", (event) => {
      setConnected(false);
      clearConnectionOnlyState();
      if (event.code !== 1000 && event.code !== 4409) {
        reconnectTimer.current = window.setTimeout(
          () => setWsAttempt((a) => a + 1),
          2000,
        );
      }
    });
    ws.addEventListener("error", () => {
      setConnected(false);
      clearConnectionOnlyState();
    });

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      ws.close();
    };
  }, [convId, wsAttempt, flushPendingQueue, reloadConversation, setCurrentRunId]);

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
      if (text || composerAttachments.length > 0) {
        setMentionQuery(null);
        setSlashQuery(null);
        sendText(text).then((ok) => { if (ok) setInput(""); });
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
    const runId = activeRunIdRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && runId) {
      ws.send(JSON.stringify({ type: "stop", run_id: runId }));
    }
    // Optimistically reset busy state so UI is responsive even if WS is flaky
    setBusy(false);
    setThinking(false);
    setWaitingForModel(false);
  };

  const handleToolApproval = useCallback((toolCallId: string, approved: boolean, scope: ApprovalScope = "once") => {
    const ws = wsRef.current;
    const runId = activeRunIdRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && runId) {
      ws.send(JSON.stringify({ type: "tool-confirm-response", run_id: runId, tool_call_id: toolCallId, approved, scope }));
    }
    const blocks = blocksRef.current.map((b) =>
      b.type === "tool" && b.tool_call_id === toolCallId
        ? {
            ...b,
            approvalStatus: approved ? "approved" as const : "denied" as const,
            approvedScope: approved ? scope : undefined,
            awaitingApproval: approved ? false : true,
          }
        : b
    );
    blocksRef.current = blocks;
    setStreamBlocks([...blocks]);
  }, []);

  // Shared logic for sending a text message to the agent
  const sendText = async (text: string) => {
    const ws = wsRef.current;
    if ((!text && composerAttachments.length === 0) || busy || uploadingAttachments || !connected || !ws || ws.readyState !== WebSocket.OPEN || !projectId) {
      setError("Disconnected — reconnecting");
      return false;
    }
    let uploaded: Attachment[] = [];
    if (composerAttachments.length > 0) {
      setUploadingAttachments(true);
      try {
        uploaded = await uploadFiles(projectId, composerAttachments.map((a) => a.file));
      } catch (e: any) {
        setError(e.message || "Upload failed");
        setUploadingAttachments(false);
        return false;
      }
      setUploadingAttachments(false);
    }
    const message_id = queueMessage(text, uploaded);
    pendingScrollMessageIdRef.current = message_id;
    ws.send(JSON.stringify({ type: "user-message", message_id, text, attachments: uploaded }));
    setComposerAttachments((prev) => {
      for (const item of prev) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    return true;
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setMentionQuery(null);
    setSlashQuery(null);
    const text = input.trim();
    sendText(text).then((ok) => { if (ok) setInput(""); });
  };

  const resend = (text: string) => {
    void sendText(text);
  };

  // Inline edit state for user messages
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editingMsgValue, setEditingMsgValue] = useState("");

  // Keyboard shortcut: Cmd+P for file finder
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        panel.toggleFileFinder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panel]);

  // Global drag indicator for file drops anywhere in the window
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      setDragDepth((depth) => depth + 1);
      setDragActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      setDragDepth((depth) => {
        const next = Math.max(0, depth - 1);
        if (next === 0) setDragActive(false);
        return next;
      });
    };
    const onDrop = () => {
      setDragDepth(0);
      setDragActive(false);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Styles
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);

  // Styles
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

  // Resizable panel width
  const [panelWidth, setPanelWidth] = useState(500);
  const dragging = useRef(false);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const isBashMode = input.startsWith("!");
  const inputPlaceholder = busy || uploadingAttachments
    ? uploadingAttachments ? "Uploading attachments..." : "Waiting for response..."
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

  useEffect(() => {
    if (!voiceUiActive) {
      if (voiceTimerRef.current !== null) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
      setVoiceElapsedSec(0);
      return;
    }
    voiceTimerRef.current = window.setInterval(() => {
      setVoiceElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => {
      if (voiceTimerRef.current !== null) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
    };
  }, [voiceUiActive]);

  const stopVoiceCapture = useCallback(() => {
    setVoiceStatusText("Finishing…");
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voice-stop" }));
    }
  }, []);

  const startVoiceCapture = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || busy || voiceUiActive) return;
    setVoiceError(null);
    setVoiceBaseText(input.trim());
    setVoiceTranscriptText("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", async (event) => {
        if (!event.data || event.data.size === 0) return;
        const buf = await event.data.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const b64 = btoa(binary);
        const socket = wsRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "voice-audio", audio: b64 }));
        }
      });
      ws.send(JSON.stringify({ type: "voice-start" }));
      recorder.start(250);
      setVoiceUiActive(true);
    } catch (e: any) {
      setVoiceError(e?.name === "NotAllowedError" ? "Microphone access was denied" : "Voice input failed. Your existing draft was preserved.");
      setVoiceStatusText("Listening…");
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setVoiceUiActive(false);
    }
  }, [busy, input]);

  const formatVoiceElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

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
        <div style={{ padding: "8px 1.5rem", minHeight: "51px", maxWidth: CHAT_HEADER_MAX_WIDTH, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <Link
              to={`/${projectId}`}
              style={{
                ...headerIconBtnStyle,
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
              data-tooltip="Conversations"
              aria-label="Conversations"
              onMouseEnter={headerHoverIn}
              onMouseLeave={headerHoverOut}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1 }}>&larr;</span>
            </Link>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0, flexShrink: 1 }}>
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
                  <span title={title} style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
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
                      flexShrink: 0,
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={toggleAutonomy}
                  disabled={savingAutonomy}
                  data-tooltip={autonomousToolsEnabled ? "Disable auto mode" : "Enable auto mode"}
                  style={{
                    ...headerIconBtnStyle,
                    background: autonomousToolsEnabled ? "rgba(77, 147, 117, 0.12)" : "var(--bg-surface)",
                    border: autonomousToolsEnabled ? "1px solid rgba(77, 147, 117, 0.35)" : "1px solid var(--border)",
                    color: autonomousToolsEnabled ? "var(--accent)" : "var(--text-muted)",
                    cursor: savingAutonomy ? "default" : "pointer",
                    opacity: savingAutonomy ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => { if (!savingAutonomy && !autonomousToolsEnabled) headerHoverIn(e); }}
                  onMouseLeave={(e) => { if (!autonomousToolsEnabled) headerHoverOut(e); }}
                >
                  <Sparkles size={15} />
                </button>
                <button
                  onClick={panel.toggleFileFinder}
                  data-tooltip="Find file (⌘P)"
                  style={{
                    ...headerIconBtnStyle,
                    color: "var(--text-muted)",
                  }}
                  onMouseEnter={headerHoverIn}
                  onMouseLeave={headerHoverOut}
                >
                  <FolderOpen size={15} />
                </button>
                {panel.file && (
                  <button
                    onClick={() => navigate(`/${projectId}/file?path=${encodeURIComponent(panel.file!.path)}`)}
                    data-tooltip="File only"
                    style={{
                      ...headerIconBtnStyle,
                      color: "var(--text-muted)",
                    }}
                    onMouseEnter={headerHoverIn}
                    onMouseLeave={headerHoverOut}
                  >
                    <FileText size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* Messages */}
        <div ref={messageListRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "4px", maxWidth: CHAT_MESSAGES_MAX_WIDTH, width: "100%", margin: "0 auto", flex: 1 }}>
          {hasMoreHistory && (
            <div style={{ alignSelf: "center", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={() => { void loadOlderHistory(); }}
                disabled={loadingOlder}
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: "999px",
                  padding: "6px 12px",
                  fontSize: "0.8rem",
                  cursor: loadingOlder ? "default" : "pointer",
                  opacity: loadingOlder ? 0.7 : 1,
                }}
              >
                {loadingOlder ? "Loading older messages…" : "Load older messages"}
              </button>
            </div>
          )}
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
                b.type === "tool" ? (
                  <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: MESSAGE_MAX_WIDTH }}>
                    <ToolChip tool={b} defaultOpen={!!m.defaultExpandedTools} onOpenFile={handleOpenFile} onRespond={handleToolApproval} />
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
                      ref={(el) => {
                        if (m.message_id === pendingScrollMessageIdRef.current) lastSentMessageRef.current = el;
                        if (m.role === "user" && i === messages.length - 1) latestUserMessageRef.current = el;
                      }}
                      data-message-id={m.message_id}
                      style={{ ...msgBubble(m.role, m.agent_color, m.bashMode), opacity: m.pending ? 0.7 : 1 }}
                    >
                      {m.attachments && m.attachments.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: b.content ? "8px" : 0 }}>
                          {m.attachments.map((attachment) => attachment.kind === "image" ? (
                            <button key={attachment.path} onClick={() => handleOpenFile(attachment.path)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                              <img src={`/api/projects/${projectId}/file/raw?path=${encodeURIComponent(attachment.path)}`} alt={attachment.name} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: "1px solid var(--border)", objectFit: "cover", display: "block" }} />
                            </button>
                          ) : (
                            <button key={attachment.path} onClick={() => handleOpenFile(attachment.path)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "var(--text)", fontSize: "0.78rem" }}>
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
              {m.role === "user" && editingMsgIdx !== i && (
                <div
                  style={{
                    alignSelf: "flex-end",
                    display: "flex",
                    gap: "2px",
                    marginTop: "-2px",
                    marginBottom: "2px",
                    minHeight: "20px",
                    visibility: busy ? "hidden" : "visible",
                    pointerEvents: busy ? "none" : "auto",
                  }}
                >
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

          {/* Live streaming / reconnect fallback */}
          {(() => {
            const reconnectPreview = !connected && streamBlocks.length > 0 ? [{
              role: "assistant" as const,
              blocks: streamBlocks,
              agent_id: activeAgent?.id,
              agent_name: activeAgent?.name,
              agent_color: activeAgent?.color,
            }] : [];
            const liveRows = connected && streamBlocks.length > 0 ? [{
              role: "assistant" as const,
              blocks: streamBlocks,
              agent_id: activeAgent?.id,
              agent_name: activeAgent?.name,
              agent_color: activeAgent?.color,
              live: true,
            }] : [];
            return [...reconnectPreview, ...liveRows].map((m, idx) => (
              <React.Fragment key={`live-${idx}`}>
                {m.agent_name && (
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
                  b.type === "tool" ? (
                    <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignSelf: "flex-start", margin: "4px 0 2px", maxWidth: MESSAGE_MAX_WIDTH }}>
                      <ToolChip tool={b} live={!!(m as any).live && !b.output} defaultOpen={!!(m as any).defaultExpandedTools} onOpenFile={handleOpenFile} onRespond={handleToolApproval} />
                    </div>
                  ) : b.type === "system" ? (
                    <div key={j} style={{ alignSelf: "center", fontSize: "0.8rem", color: b.tone === "error" ? "#c4554d" : "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "999px", padding: "6px 10px", margin: "6px 0", maxWidth: "100%" }}>
                      {b.content}
                    </div>
                  ) : b.type === "text" && b.content ? (
                    <div key={j} style={{ position: "relative", maxWidth: MESSAGE_MAX_WIDTH, alignSelf: "flex-start" }}>
                      <div style={{ ...msgBubble("assistant", m.agent_color), maxWidth: "100%", paddingRight: "42px" }}>
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
              </React.Fragment>
            ));
          })()}

          {/* Thinking / waiting indicator */}
          {waitingForModel && (
            <div style={{
              alignSelf: "flex-start",
              padding: "10px 14px",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
            }}>
              <span style={{ display: "inline-flex", gap: "5px", fontSize: "1.05rem", fontWeight: 600, lineHeight: 1, opacity: 0.9 }}>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0s" }}>•</span>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.2s" }}>•</span>
                <span style={{ animation: "pulse 1.2s infinite", animationDelay: "0.4s" }}>•</span>
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>
              {error}
            </div>
          )}
          {voiceError && (
            <div style={{ fontSize: "0.8rem", color: "#c4554d", textAlign: "center", margin: "8px 0" }}>
              {voiceError}
            </div>
          )}

          <div style={{ flexShrink: 0, height: `${bottomSlackPx}px`, pointerEvents: "none" }} />
        </div>
        </div>

        {/* Input */}
        <div style={{ flexShrink: 0, padding: "0 1.5rem 12px" }}>
        <div style={{ position: "relative", maxWidth: CHAT_INPUT_MAX_WIDTH, width: "100%", margin: "0 auto" }}>
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
          <form onSubmit={send} onDrop={(e) => { e.preventDefault(); setDragDepth(0); setDragActive(false); if (e.dataTransfer.files?.length) addComposerFiles(e.dataTransfer.files); }} onDragOver={(e) => { e.preventDefault(); setDragActive(true); }} onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; if (dragDepth === 0) setDragActive(false); }} style={{
            display: "flex",
            gap: "8px",
            padding: "10px 14px",
            background: dragActive
              ? "color-mix(in srgb, var(--bg-surface) 82%, var(--accent) 18%)"
              : (isBashMode ? "var(--bg-bash-composer)" : "var(--bg-surface)"),
            border: `1px solid ${dragActive ? "var(--accent)" : (isBashMode ? "var(--border-bash-composer)" : "var(--border)")}`,
            borderRadius: "12px",
            flexDirection: "column",
            boxShadow: dragActive ? "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)" : "none",
            transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
            position: "relative",
          }}>
            {voiceUiActive && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))",
                background: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 1.2s infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: "0.85rem", fontWeight: 500, minWidth: 0 }}>{voiceStatusText}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{formatVoiceElapsed(voiceElapsedSec)}</span>
                </div>
                <button type="button" onClick={stopVoiceCapture} style={{
                  background: "color-mix(in srgb, var(--bg) 76%, var(--accent) 24%)",
                  color: "var(--text)",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
                  borderRadius: "999px",
                  padding: "5px 10px",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}>
                  <Square size={12} fill="currentColor" /> Stop voice
                </button>
              </div>
            )}
            {dragActive && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                minHeight: "44px",
                border: "1px dashed var(--accent)",
                borderRadius: "10px",
                background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                color: "var(--accent)",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}>
                <Paperclip size={16} /> Drop files here
              </div>
            )}
            {composerAttachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {composerAttachments.map((attachment, idx) => (
                  <div key={`${attachment.file.name}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 8, padding: attachment.previewUrl ? 4 : "6px 8px" }}>
                    {attachment.previewUrl ? (
                      <img src={attachment.previewUrl} alt={attachment.file.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span style={{ fontSize: "0.78rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.file.name}</span>
                    <button type="button" onClick={() => removeComposerAttachment(idx)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "inline-flex", padding: 0 }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
            {isBashMode ? (
              <span data-tooltip="Bash mode" style={{ color: "var(--border-bash-composer)", display: "inline-flex", alignItems: "center", padding: "4px 2px", flexShrink: 0 }}>
                <Terminal size={16} />
              </span>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", cursor: "pointer", padding: "4px 2px", flexShrink: 0 }} data-tooltip="Attach files">
                <Paperclip size={16} />
              </button>
            )}
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addComposerFiles(e.target.files); e.currentTarget.value = ""; }} />
            <textarea
              ref={inputRef}
              rows={1}
              readOnly={voiceUiActive}
              style={{
                ...inputStyle,
                background: "transparent",
                border: "none",
                resize: "none",
                overflowY: "auto",
                lineHeight: "1.5",
                minHeight: "24px",
                maxHeight: "200px",
              }}
              placeholder={inputPlaceholder}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files || []);
                if (files.length > 0) addComposerFiles(files);
              }}
              autoFocus
            />
            {!busy && !voiceUiActive && (
              <button
                type="button"
                onClick={() => { void startVoiceCapture(); }}
                style={{
                  background: "color-mix(in srgb, var(--accent) 12%, var(--bg))",
                  color: "var(--text)",
                  border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
                  borderRadius: "999px",
                  width: "34px",
                  height: "34px",
                  minWidth: "34px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  flexShrink: 0,
                }}
                data-tooltip="Start voice input"
              >
                <Mic size={15} />
              </button>
            )}
            {busy ? (
              <button
                type="button"
                onClick={stop}
                style={{
                  ...btnPrimary,
                  width: "34px",
                  height: "34px",
                  minWidth: "34px",
                  borderRadius: "999px",
                  background: "var(--text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                data-tooltip="Stop"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                style={{
                  ...btnPrimary,
                  width: "34px",
                  height: "34px",
                  minWidth: "34px",
                  borderRadius: "999px",
                  opacity: !connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments ? 0.5 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  flexShrink: 0,
                }}
                disabled={!connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments}
                data-tooltip="Send"
              >
                <ArrowUp size={16} />
              </button>
            )}
            </div>
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
            onOpenFileFinder={panel.toggleFileFinder}
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
