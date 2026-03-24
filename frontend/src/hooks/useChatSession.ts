import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { connectWs, getConvo, listFiles, listProjectAgents, listSkills, updateConvo, uploadFiles, type AgentConfig, type Attachment, type Skill, type WsEvent } from "../api";
import { buildDisplayMessages, messageIdentity, type ApprovalScope, type DisplayMessage, type MetaInfo, type StreamBlock } from "../chatState";
import type { ComposerAttachment } from "../chatComposer";
import { getBottomSlackPx, getUserMessageTopOffsetPx } from "../chatSessionState";

const INITIAL_HISTORY_PAGE_SIZE = 100;
const OLDER_HISTORY_PAGE_SIZE = 100;

export function useChatSession(projectId?: string, convId?: string) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([]);
  const [waitingForModel, setWaitingForModel] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [autonomousToolsEnabled, setAutonomousToolsEnabled] = useState(false);
  const [savingAutonomy, setSavingAutonomy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [title, setTitle] = useState("Untitled");
  const [wsAttempt, setWsAttempt] = useState(0);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const mentionRefreshInFlightRef = useRef(false);
  const [activeAgent, setActiveAgent] = useState<{ id: string; name: string; color?: string; model?: string } | null>(null);
  const [pendingMessages, setPendingMessages] = useState<{ message_id: string; text: string; attachments?: Attachment[] }[]>([]);
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

  const activeAgentRef = useRef<{ id: string; name: string; color?: string; model?: string } | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<{ message_id: string; text: string; attachments?: Attachment[] }[]>([]);
  const flushingQueueRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const lastSentMessageRef = useRef<HTMLDivElement | null>(null);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<StreamBlock[]>([]);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const voiceTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceBaseTextRef = useRef("");
  const hasConnectedRef = useRef(false);
  const replayingRef = useRef(false);
  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  const prependScrollRestoreRef = useRef<number | null>(null);

  const savedScrollKeyRef = useRef<string | null>(null);

  const getUserMessageTopOffset = useCallback(() => getUserMessageTopOffsetPx(window.innerHeight), []);

  const bottomSlackPx = useMemo(() => {
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    return getBottomSlackPx(viewportHeight);
  }, []);

  const scrollUserMessageNearTop = useCallback((messageEl: HTMLDivElement | null, behavior: ScrollBehavior = "smooth") => {
    const container = messageListRef.current;
    if (!container || !messageEl) return;
    const targetTop = messageEl.offsetTop - getUserMessageTopOffset();
    container.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, [getUserMessageTopOffset]);

  const syncPendingMessages = useCallback((updater: { message_id: string; text: string; attachments?: Attachment[] }[] | ((prev: { message_id: string; text: string; attachments?: Attachment[] }[]) => { message_id: string; text: string; attachments?: Attachment[] }[])) => {
    setPendingMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      pendingMessagesRef.current = next;
      return next;
    });
  }, []);

  const markMessagePending = useCallback((messageId: string, pending: boolean) => {
    setMessages((prev) => prev.map((msg) => msg.message_id === messageId ? { ...msg, pending } : msg));
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
    setMessages((prev) => [...prev, { role: "user", blocks: [{ type: "text", content: text }], message_id, pending: true, attachments, bashMode: text.startsWith("!") }]);
    setBusy(true);
    setWaitingForModel(true);
    setError(null);
    return message_id;
  }, [syncPendingMessages]);

  const addComposerFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({ file, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined }));
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

  // Persist scroll position to sessionStorage so browser refresh restores it
  useEffect(() => {
    if (!convId) return;
    const key = `remote-lab:scroll:${convId}`;
    savedScrollKeyRef.current = key;
    const saveScroll = () => {
      const container = messageListRef.current;
      if (container) sessionStorage.setItem(key, String(container.scrollTop));
    };
    window.addEventListener("beforeunload", saveScroll);
    return () => window.removeEventListener("beforeunload", saveScroll);
  }, [convId]);

  useLayoutEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0 || messageListRef.current == null) return;
    requestAnimationFrame(() => {
      const container = messageListRef.current;
      if (!container) return;
      const key = savedScrollKeyRef.current;
      const saved = key ? sessionStorage.getItem(key) : null;
      if (saved != null) {
        container.scrollTop = Number(saved);
        sessionStorage.removeItem(key);
      } else if (latestUserMessageRef.current) {
        scrollUserMessageNearTop(latestUserMessageRef.current, "auto");
      } else {
        container.scrollTop = container.scrollHeight;
      }
      initialScrollDoneRef.current = true;
    });
  }, [messages.length, scrollUserMessageNearTop]);

  const refreshMentionFiles = useCallback(async () => {
    if (!projectId || mentionRefreshInFlightRef.current) return;
    mentionRefreshInFlightRef.current = true;
    try {
      const res = await listFiles(projectId, { hidden: true });
      setProjectFiles(res.files);
    } catch {}
    finally {
      mentionRefreshInFlightRef.current = false;
    }
  }, [projectId]);

  const reloadConversation = useCallback(async () => {
    if (!convId || !projectId) return;
    const [detail, agentRes] = await Promise.all([getConvo(convId, { limit: INITIAL_HISTORY_PAGE_SIZE }), listProjectAgents(projectId)]);
    const agentList = agentRes.agents;
    setAgents(agentList);
    const rebuilt = buildDisplayMessages(detail, agentList);
    setTitle(rebuilt.title);
    setAutonomousToolsEnabled(rebuilt.autonomousToolsEnabled);
    setHasMoreHistory(detail.has_more);
    setHistoryCursor(detail.next_before);
    setMessages((prev) => {
      const pending = prev.filter((msg) => msg.pending);
      return [...rebuilt.messages, ...pending];
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

  useEffect(() => {
    reloadConversation().catch((e) => setError(e.message));
  }, [reloadConversation]);

  useEffect(() => {
    if (!projectId) return;
    listFiles(projectId, { hidden: true }).then((res) => setProjectFiles(res.files)).catch(() => setProjectFiles([]));
    listSkills(projectId).then(setSkills).catch(() => setSkills([]));
  }, [projectId]);

  useEffect(() => {
    if (!convId) return;
    const ws = connectWs(convId);
    wsRef.current = ws;

    ws.addEventListener("message", (event) => {
      let data: WsEvent;
      try { data = JSON.parse(event.data); } catch { return; }
      switch (data.type) {
        case "auth-ok":
          setConnected(true);
          flushPendingQueue();
          break;
        case "sync":
          // Server sends sync after auth-ok + any active-run replay.
          // Flush suppressed renders from reconnect replay.
          if (replayingRef.current) {
            replayingRef.current = false;
            setStreamBlocks([...blocksRef.current]);
          }
          // On reconnect with no active run, reload to pick up any
          // state changes (e.g. run finished while disconnected).
          if (hasConnectedRef.current && !data.running) {
            reloadConversation().catch(() => {});
          }
          hasConnectedRef.current = true;
          break;
        case "message-ack": syncPendingMessages((prev) => prev.filter((msg) => msg.message_id !== data.message_id)); markMessagePending(data.message_id, false); setError(null); break;
        case "voice-state":
          if (data.state === "starting") { setVoiceError(null); setVoiceStatusText("Starting microphone…"); setVoiceUiActive(true); }
          else if (data.state === "listening") { setVoiceStatusText("Listening…"); setVoiceUiActive(true); }
          else if (data.state === "stopped") { setVoiceStatusText("Listening…"); setVoiceUiActive(false); }
          break;
        case "voice-transcript": { const base = voiceBaseTextRef.current; setVoiceTranscriptText(data.text); setInput(`${base}${base && data.text ? " " : ""}${data.text}`); break; }
        case "running": {
          const isReconnect = data.run_id === activeRunIdRef.current;
          setCurrentRunId(data.run_id); setBusy(true); setWaitingForModel(true);
          blocksRef.current = [];
          if (isReconnect) {
            // Reconnect replay: suppress renders until sync arrives
            replayingRef.current = true;
          } else {
            replayingRef.current = false;
            setStreamBlocks([]);
          }
          break;
        }
        case "agent-start": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const ag = { id: data.agent_id, name: data.agent_name, color: data.agent_color, model: data.agent_model };
          activeAgentRef.current = ag; setActiveAgent(ag);
          if (data.agent_model) setMeta((prev) => prev ? { ...prev, model: data.agent_model } : { turns: 0, context_tokens: 0, context_limit: 0, model: data.agent_model });
          break;
        }
        case "thinking-delta": if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break; break;
        case "text-delta": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setWaitingForModel(false);
          const blocks = blocksRef.current; const last = blocks[blocks.length - 1];
          if (last && last.type === "text") last.content += data.delta; else blocks.push({ type: "text", content: data.delta });
          blocksRef.current = [...blocks]; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-use": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(false);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) {
              blocks[i] = { ...b, input: data.input ?? b.input, awaitingApproval: false, approvalStatus: b.approvalStatus === "denied" ? b.approvalStatus : undefined, canAllowProject: b.canAllowProject };
              matched = true; break;
            }
          }
          if (!matched) blocks.push({ type: "tool", name: data.name, input: data.input, tool_call_id: data.tool_call_id, run_id: data.run_id });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-output": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          const oBlocks = [...blocksRef.current];
          for (let i = oBlocks.length - 1; i >= 0; i--) {
            const b = oBlocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) { oBlocks[i] = { ...b, liveOutput: (b.liveOutput || "") + data.output }; break; }
          }
          blocksRef.current = oBlocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "tool-result": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(true);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && (data.tool_call_id ? b.tool_call_id === data.tool_call_id : b.name === data.name) && !b.output) { blocks[i] = { ...b, output: b.liveOutput || data.output, diff: data.diff ?? b.diff, liveOutput: undefined }; matched = true; break; }
          }
          if (!matched) blocks.push({ type: "tool", name: data.name, output: data.output, diff: data.diff, tool_call_id: data.tool_call_id, run_id: data.run_id });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "file-changed": setProjectFiles((prev) => prev.includes(data.path) ? prev : [...prev, data.path].sort()); break;
        case "tool-confirm": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          if (!replayingRef.current) setWaitingForModel(false);
          const blocks = [...blocksRef.current]; let matched = false;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool" && b.tool_call_id === data.tool_call_id) { blocks[i] = { ...b, name: data.name, input: data.args ?? b.input, awaitingApproval: true, approvalStatus: "pending", canAllowProject: data.can_allow_project !== false, canTurnOnAuto: data.can_turn_on_auto !== false }; matched = true; break; }
          }
          if (!matched) blocks.push({ type: "tool", tool_call_id: data.tool_call_id, run_id: data.run_id, name: data.name, input: data.args, awaitingApproval: true, approvalStatus: "pending", canAllowProject: data.can_allow_project !== false, canTurnOnAuto: data.can_turn_on_auto !== false });
          blocksRef.current = blocks; if (!replayingRef.current) setStreamBlocks(blocksRef.current); break;
        }
        case "done": {
          if (activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          replayingRef.current = false;
          const status = data.status || "ok";
          if (status === "error" && data.error_message) setError(data.error_message);
          const finalBlocks = blocksRef.current;
          if (finalBlocks.length > 0) {
            const ag = activeAgentRef.current;
            const onlyBashOutput = finalBlocks.length > 0 && finalBlocks.every((b) => b.type === "tool" && b.name === "bash" && !!b.output);
            const finalMessage: DisplayMessage = { role: "assistant", blocks: [...finalBlocks], agent_id: data.agent_id || ag?.id, agent_name: ag?.name, agent_color: ag?.color, defaultExpandedTools: onlyBashOutput };
            setMessages((msgs) => msgs.some((msg) => messageIdentity(msg) === messageIdentity(finalMessage)) ? msgs : [...msgs, finalMessage]);
          }
          blocksRef.current = []; setStreamBlocks([]); setWaitingForModel(false); activeAgentRef.current = null; setActiveAgent(null);
          if (data.context_limit > 0) setMeta((prev) => ({ turns: data.turns, context_tokens: data.context_tokens, context_limit: data.context_limit, model: prev?.model }));
          setBusy(false); setCurrentRunId(null); break;
        }
        case "compacted": setMeta((prev) => prev ? { ...prev, context_tokens: data.new_tokens } : prev); setMessages((msgs) => [...msgs, { role: "assistant", blocks: [{ type: "tool", name: "compact", input: `${(data.old_tokens / 1000).toFixed(1)}k → ${(data.new_tokens / 1000).toFixed(1)}k tokens` }] }]); setWaitingForModel(false); setBusy(false); break;
        case "skill-result": setMessages((msgs) => [...msgs, { role: "assistant", blocks: [{ type: "tool", name: data.skill, input: data.output }] }]); setWaitingForModel(false); setBusy(false); break;
        case "title-updated": setTitle(data.title); break;
        case "error":
          if (!data.run_id && data.message.startsWith("Voice input failed")) { setVoiceError(data.message); setVoiceUiActive(false); break; }
          if (data.run_id && activeRunIdRef.current && data.run_id !== activeRunIdRef.current) break;
          setError(data.message);
          // Non-run errors (e.g. "Agent is still running") — clean up UI state.
          // Run errors are handled by the Done event with status="error"|"cancelled".
          if (!data.run_id) {
            blocksRef.current = []; setStreamBlocks([]); setWaitingForModel(false); setBusy(false); setCurrentRunId(null);
          }
          break;
      }
    });

    ws.addEventListener("close", (event) => {
      setConnected(false);
      if (event.code !== 1000 && event.code !== 4409) reconnectTimer.current = window.setTimeout(() => setWsAttempt((a) => a + 1), 2000);
    });
    ws.addEventListener("error", () => { setConnected(false); });

    return () => {
      clearTimeout(reconnectTimer.current);
      mediaRecorderRef.current?.stop(); mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null;
      ws.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- voiceBaseText read via ref to avoid WS reconnect
  }, [convId, wsAttempt, flushPendingQueue, reloadConversation, setCurrentRunId]);

  useEffect(() => {
    if (!voiceUiActive) {
      if (voiceTimerRef.current !== null) { window.clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
      setVoiceElapsedSec(0); return;
    }
    voiceTimerRef.current = window.setInterval(() => setVoiceElapsedSec((prev) => prev + 1), 1000);
    return () => {
      if (voiceTimerRef.current !== null) { window.clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
    };
  }, [voiceUiActive]);

  const stop = useCallback(() => {
    const ws = wsRef.current; const runId = activeRunIdRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && runId) ws.send(JSON.stringify({ type: "stop", run_id: runId }));
    setBusy(false); setWaitingForModel(false);
  }, []);

  const handleToolApproval = useCallback(async (toolCallId: string, approved: boolean, scope: ApprovalScope = "once") => {
    if (approved && scope === "auto" && convId) {
      setSavingAutonomy(true);
      try {
        const updated = await updateConvo(convId, { autonomous_tools_enabled: true });
        setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled);
      } catch (e: any) {
        setError(e.message || "Failed to enable auto mode"); setSavingAutonomy(false); return;
      }
      setSavingAutonomy(false);
    }
    const ws = wsRef.current; const runId = activeRunIdRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && runId) ws.send(JSON.stringify({ type: "tool-confirm-response", run_id: runId, tool_call_id: toolCallId, approved, scope }));
    const blocks = blocksRef.current.map((b) => b.type === "tool" && b.tool_call_id === toolCallId ? { ...b, approvalStatus: approved ? "approved" as const : "denied" as const, approvedScope: approved ? scope : undefined, awaitingApproval: approved ? false : true } : b);
    blocksRef.current = blocks; setStreamBlocks([...blocks]);
  }, [convId]);

  const sendText = useCallback(async (text: string) => {
    const ws = wsRef.current;
    if ((!text && composerAttachments.length === 0) || busy || uploadingAttachments || !connected || !ws || ws.readyState !== WebSocket.OPEN || !projectId) {
      setError("Disconnected — reconnecting"); return false;
    }
    let uploaded: Attachment[] = [];
    if (composerAttachments.length > 0) {
      setUploadingAttachments(true);
      try { uploaded = await uploadFiles(projectId, composerAttachments.map((a) => a.file)); }
      catch (e: any) { setError(e.message || "Upload failed"); setUploadingAttachments(false); return false; }
      setUploadingAttachments(false);
    }
    const message_id = queueMessage(text, uploaded);
    pendingScrollMessageIdRef.current = message_id;
    ws.send(JSON.stringify({ type: "user-message", message_id, text, attachments: uploaded }));
    setComposerAttachments((prev) => { for (const item of prev) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); return []; });
    return true;
  }, [busy, composerAttachments, connected, projectId, queueMessage, uploadingAttachments]);

  const resend = useCallback((text: string) => { void sendText(text); }, [sendText]);

  const stopVoiceCapture = useCallback(() => {
    setVoiceStatusText("Finishing…"); mediaRecorderRef.current?.stop(); mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null;
    const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "voice-stop" }));
  }, []);

  const startVoiceCapture = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || busy || voiceUiActive) return;
    setVoiceError(null); setVoiceBaseText(input.trim()); voiceBaseTextRef.current = input.trim(); setVoiceTranscriptText("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", async (event) => {
        if (!event.data || event.data.size === 0) return;
        const buf = await event.data.arrayBuffer(); const bytes = new Uint8Array(buf); let binary = ""; const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        const b64 = btoa(binary); const socket = wsRef.current; if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "voice-audio", audio: b64 }));
      });
      ws.send(JSON.stringify({ type: "voice-start" })); recorder.start(250); setVoiceUiActive(true);
    } catch (e: any) {
      setVoiceError(e?.name === "NotAllowedError" ? "Microphone access was denied" : "Voice input failed. Your existing draft was preserved.");
      setVoiceStatusText("Listening…"); mediaRecorderRef.current = null; mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null; setVoiceUiActive(false);
    }
  }, [busy, input, voiceUiActive]);

  const toggleAutonomy = useCallback(async () => {
    if (!convId || savingAutonomy) return;
    const next = !autonomousToolsEnabled; setSavingAutonomy(true);
    try { const updated = await updateConvo(convId, { autonomous_tools_enabled: next }); setAutonomousToolsEnabled(!!updated.autonomous_tools_enabled); }
    catch (e: any) { setError(e.message || "Failed to update autonomous mode"); }
    finally { setSavingAutonomy(false); }
  }, [convId, autonomousToolsEnabled, savingAutonomy]);

  return {
    messages, streamBlocks, waitingForModel, input, setInput, busy, meta, setMeta,
    autonomousToolsEnabled, savingAutonomy, error, connected, title, setTitle,
    agents, projectFiles, skills, activeAgent, hasMoreHistory, loadingOlder,
    composerAttachments, uploadingAttachments, voiceUiActive, voiceElapsedSec,
    voiceError, voiceStatusText, messageListRef, pendingScrollMessageIdRef,
    lastSentMessageRef, latestUserMessageRef, bottomSlackPx,
    refreshMentionFiles, loadOlderHistory, addComposerFiles, removeComposerAttachment,
    handleToolApproval, sendText, resend, stop, stopVoiceCapture, startVoiceCapture,
    toggleAutonomy, setError, setProjectFiles,
  };
}
