import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { FileText, Pencil, FolderOpen, Sparkles, Archive } from "lucide-react";
import { getConvo, updateConvo, connectWs, listProjectAgents, listFiles, listSkills, uploadFiles, type WsEvent, type AgentConfig, type Attachment } from "../api";
import { btnIcon } from "../styles";
import { buildDisplayMessages, mergeAssistantMessages, messageIdentity, type ApprovalScope, type DisplayMessage, type MetaInfo, type StreamBlock } from "../chatState";

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
import { FilePanel } from "../components/FilePanel";
import { FileFinder } from "../components/FileFinder";
import { usePanel } from "../hooks/usePanel";
import { extractFilePath } from "../chatUi";
import { ChatComposer, type ComposerAttachment } from "../chatComposer";
import { ChatMessages } from "../chatMessages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  input?: string;
  output?: string;
  diff?: string;
  liveOutput?: string;
}

interface PendingMessage {
  message_id: string;
  text: string;
  attachments?: Attachment[];
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
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH_RATIO = 0.75;
const PANEL_DEFAULT_WIDTH_RATIO = 0.36;
const PANEL_RESIZE_HIT_WIDTH = 14;
const PANEL_RESIZE_VISIBLE_WIDTH = 4;
const PANEL_RESIZE_ACTIVATION_DELTA = 3;
const CHAT_PANEL_RATIO_STORAGE_KEY = "remote-lab:chat-panel-width-ratio";

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
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const mentionRefreshInFlightRef = useRef(false);
  // Track active agent info during streaming (for multi-agent labeling)
  const [activeAgent, setActiveAgent] = useState<{ id: string; name: string; color?: string } | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
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

  const refreshMentionFiles = useCallback(async () => {
    if (!projectId || mentionRefreshInFlightRef.current) return;
    mentionRefreshInFlightRef.current = true;
    try {
      const res = await listFiles(projectId);
      setProjectFiles(res.files);
    } catch {}
    finally {
      mentionRefreshInFlightRef.current = false;
    }
  }, [projectId]);

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
      const pendingOnly = prev.filter((msg) => msg.pending);
      return mergeAssistantMessages(rebuilt.messages, pendingOnly);
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
                canAllowProject: b.canAllowProject,
              };
              matched = true;
              break;
            }
          }
          if (!matched) {
            blocks.push({ type: "tool", name: data.name, input: data.input, tool_call_id: data.tool_call_id, run_id: data.run_id });
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
          let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              blocks[i] = { ...b, output: b.liveOutput || data.output, diff: data.diff ?? b.diff, liveOutput: undefined };
              matched = true;
              break;
            }
          }
          if (!matched) {
            blocks.push({ type: "tool", name: data.name, output: data.output, diff: data.diff, tool_call_id: data.tool_call_id, run_id: data.run_id });
          }
          blocksRef.current = blocks;
          setStreamBlocks(blocksRef.current);
          break;
        }
        case "file-changed": {
          panel.applyExternalChange(data.path);
          setProjectFiles((prev) => prev.includes(data.path) ? prev : [...prev, data.path].sort());
          break;
        }
        case "tool-confirm": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(false);
          const blocks = [...blocksRef.current];
          let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && b.tool_call_id === data.tool_call_id) {
              blocks[i] = {
                ...b,
                name: data.name,
                input: data.args ?? b.input,
                awaitingApproval: true,
                approvalStatus: "pending",
                canAllowProject: data.can_allow_project !== false,
                canTurnOnAuto: data.can_turn_on_auto !== false,
              };
              matched = true;
              break;
            }
          }
          if (!matched) {
            blocks.push({
              type: "tool",
              tool_call_id: data.tool_call_id,
              run_id: data.run_id,
              name: data.name,
              input: data.args,
              awaitingApproval: true,
              approvalStatus: "pending",
              canAllowProject: data.can_allow_project !== false,
              canTurnOnAuto: data.can_turn_on_auto !== false,
            });
          }
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

  const archiveConversation = useCallback(async () => {
    if (!convId) return;
    try {
      await updateConvo(convId, { archived_at: new Date().toISOString() });
      navigate(`/${projectId}`);
    } catch (e: any) {
      setError(e.message || "Failed to archive conversation");
    }
  }, [convId, navigate, projectId]);

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

  const handleToolApproval = useCallback(async (toolCallId: string, approved: boolean, scope: ApprovalScope = "once") => {
    if (approved && scope === "auto" && convId) {
      setSavingAutonomy(true);
      try {
        const updated = await updateConvo(convId, { autonomous_tools_enabled: true });
        setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled);
      } catch (e: any) {
        setError(e.message || "Failed to enable auto mode");
        setSavingAutonomy(false);
        return;
      }
      setSavingAutonomy(false);
    }
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
  }, [convId]);

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

  const resend = (text: string) => {
    void sendText(text);
  };

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

  // Resizable panel width
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 500;
    const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
    const storedRatio = Number(window.localStorage.getItem(CHAT_PANEL_RATIO_STORAGE_KEY));
    const ratio = Number.isFinite(storedRatio) && storedRatio > 0
      ? Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, storedRatio))
      : PANEL_DEFAULT_WIDTH_RATIO;
    return Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(window.innerWidth * ratio)));
  });
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const dragging = useRef(false);
  const dragActivatedRef = useRef(false);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragActivatedRef.current = false;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - e.clientX;
      if (!dragActivatedRef.current && Math.abs(delta) < PANEL_RESIZE_ACTIVATION_DELTA) return;
      dragActivatedRef.current = true;
      setPanelResizeActive(true);
      const nextWidth = Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, startWidth + delta));
      setPanelWidth(nextWidth);
      window.localStorage.setItem(CHAT_PANEL_RATIO_STORAGE_KEY, String(nextWidth / window.innerWidth));
    };
    const onMouseUp = () => {
      dragging.current = false;
      dragActivatedRef.current = false;
      setPanelResizeActive(false);
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
    if (!panel.file || typeof window === "undefined") return;
    const onResize = () => {
      const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
      const storedRatio = Number(window.localStorage.getItem(CHAT_PANEL_RATIO_STORAGE_KEY));
      const ratio = Number.isFinite(storedRatio) && storedRatio > 0
        ? Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, storedRatio))
        : Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, PANEL_DEFAULT_WIDTH_RATIO));
      setPanelWidth(Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(window.innerWidth * ratio))));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel.file]);

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
        <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0, position: "relative", zIndex: 2 }}>
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
                  onClick={archiveConversation}
                  data-tooltip="Archive conversation"
                  aria-label="Archive conversation"
                  style={{
                    ...headerIconBtnStyle,
                    color: "var(--text-muted)",
                  }}
                  onMouseEnter={headerHoverIn}
                  onMouseLeave={headerHoverOut}
                >
                  <Archive size={15} />
                </button>
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
        <ChatMessages
          projectId={projectId}
          messages={messages}
          streamBlocks={streamBlocks}
          activeAgent={activeAgent}
          connected={connected}
          waitingForModel={waitingForModel}
          error={error}
          voiceError={voiceError}
          hasMoreHistory={hasMoreHistory}
          loadingOlder={loadingOlder}
          bottomSlackPx={bottomSlackPx}
          autonomousToolsEnabled={autonomousToolsEnabled}
          messageListRef={messageListRef}
          pendingScrollMessageIdRef={pendingScrollMessageIdRef}
          lastSentMessageRef={lastSentMessageRef}
          latestUserMessageRef={latestUserMessageRef}
          onLoadOlderHistory={() => { void loadOlderHistory(); }}
          onOpenFile={handleOpenFile}
          onToolApproval={handleToolApproval}
          resend={resend}
        />

        {/* Input */}
        <ChatComposer
          input={input}
          setInput={setInput}
          busy={busy}
          connected={connected}
          uploadingAttachments={uploadingAttachments}
          composerAttachments={composerAttachments}
          addComposerFiles={addComposerFiles}
          removeComposerAttachment={removeComposerAttachment}
          sendText={sendText}
          voiceUiActive={voiceUiActive}
          voiceStatusText={voiceStatusText}
          voiceElapsedSec={voiceElapsedSec}
          stopVoiceCapture={stopVoiceCapture}
          startVoiceCapture={startVoiceCapture}
          stop={stop}
          agents={agents}
          projectFiles={projectFiles}
          skills={skills}
          refreshMentionFiles={refreshMentionFiles}
        />
      </div>

      {/* Resize handle + File panel */}
      {panel.file && (
        <>
        <div
          onMouseDown={onDragStart}
          style={{
            width: `${PANEL_RESIZE_HIT_WIDTH}px`,
            marginLeft: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`,
            marginRight: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`,
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
            position: "relative",
            zIndex: 10,
            touchAction: "none",
          }}
          onMouseEnter={(e) => {
            if (!panelResizeActive) e.currentTarget.style.background = "transparent";
          }}
          onMouseLeave={(e) => {
            if (!dragging.current && !panelResizeActive) e.currentTarget.style.background = "transparent";
          }}
        >
          <div style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `calc(50% - ${PANEL_RESIZE_VISIBLE_WIDTH / 2}px)`,
            width: `${PANEL_RESIZE_VISIBLE_WIDTH}px`,
            borderRadius: 999,
            background: panelResizeActive
              ? "color-mix(in srgb, var(--accent) 55%, var(--border))"
              : "var(--border)",
            opacity: panelResizeActive ? 1 : 0.45,
            boxShadow: panelResizeActive ? "0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent)" : "none",
          }} />
        </div>
        <div
          className="artifact-panel-wrap"
          style={{
            width: `${panelWidth}px`,
            flexShrink: 0,
            height: "calc(var(--vh, 1vh) * 100)",
            overflow: "hidden",
            pointerEvents: panelResizeActive ? "none" : undefined,
          }}
        >
          <FilePanel
            file={panel.file}
            editMode={panel.editMode}
            dirty={panel.dirty}
            saving={panel.saving}
            saveError={panel.saveError}
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
